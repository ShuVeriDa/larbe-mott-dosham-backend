import { PrismaPg } from "@prisma/adapter-pg";
import { PermissionCode, PrismaClient, RoleName } from "@prisma/client";
import { hash } from "argon2";
import * as crypto from "crypto";
import "dotenv/config";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

/** Маппинг ролей → разрешения */
const ROLE_PERMISSIONS: Record<RoleName, PermissionCode[]> = {
  [RoleName.USER]: [],
  [RoleName.EDITOR]: [
    PermissionCode.CAN_EDIT_ENTRIES,
    PermissionCode.CAN_ADD_ENTRIES,
  ],
  [RoleName.ADMIN]: [
    PermissionCode.CAN_EDIT_ENTRIES,
    PermissionCode.CAN_ADD_ENTRIES,
    PermissionCode.CAN_DELETE_ENTRIES,
    PermissionCode.CAN_MANAGE_USERS,
    PermissionCode.CAN_MANAGE_API_KEYS,
    PermissionCode.CAN_RUN_PIPELINE,
  ],
};

async function main() {
  console.log("Seeding database...\n");

  // 1. Создаём разрешения
  const permissionRecords: Record<PermissionCode, string> = {} as any;
  for (const code of Object.values(PermissionCode)) {
    const perm = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code },
    });
    permissionRecords[code] = perm.id;
    console.log(`  Permission: ${code}`);
  }

  // 2. Создаём роли и привязываем разрешения
  for (const name of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });

    const perms = ROLE_PERMISSIONS[name];
    for (const code of perms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permissionRecords[code],
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permissionRecords[code],
        },
      });
    }
    console.log(`  Role: ${name} (${perms.length} permissions)`);
  }

  // 3. Создаём admin-пользователя
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@dosham.mottlarbe.com";
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("ADMIN_PASSWORD environment variable is required for seeding");
  }
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        username: "admin",
        name: "Admin",
        password: await hash(adminPassword),
      },
    });

    // Назначаем роль ADMIN
    const adminRole = await prisma.role.findUnique({
      where: { name: RoleName.ADMIN },
    });
    if (adminRole) {
      await prisma.userRoleAssignment.create({
        data: { userId: admin.id, roleId: adminRole.id },
      });
    }

    console.log(`\n  Admin user created:`);
    console.log(`    email: ${adminEmail}`);
    console.log(`    password: ${adminPassword}`);
    console.log(`    ⚠️  Change the password after first login!`);
  } else {
    console.log(`\n  Admin user already exists: ${adminEmail}`);
  }

  // 4. Создаём API-ключ для читалки (editor)
  const readerApiKeyValue = `dosham-editor-${crypto.randomBytes(16).toString("hex")}`;
  const existingKey = await prisma.apiKey.findFirst({
    where: { name: "MottLarbe Reader" },
  });

  if (!existingKey) {
    await prisma.apiKey.create({
      data: {
        key: readerApiKeyValue,
        name: "MottLarbe Reader",
        role: RoleName.EDITOR,
      },
    });
    console.log(`\n  API key created for "MottLarbe Reader":`);
    console.log(`    key: ${readerApiKeyValue}`);
    console.log(`    role: EDITOR`);
    console.log(`    ⚠️  Save this key — it won't be shown again!`);
  } else {
    console.log(`\n  API key "MottLarbe Reader" already exists`);
  }

  console.log("\nSeed completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
