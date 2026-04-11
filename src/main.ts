import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import * as dotenv from "dotenv";
import { WINSTON_MODULE_NEST_PROVIDER } from "nest-winston";
import { AppModule } from "./app.module";

async function bootstrap() {
  dotenv.config();

  const app = await NestFactory.create(AppModule, { logger: false });

  // После инициализации переключаем на Winston
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);

  const port = configService.get<number>("PORT") ?? 9666;
  const rawOrigins = configService.get<string>("ALLOWED_ORIGINS");
  const allowedOrigins = rawOrigins?.trim()
    ? rawOrigins
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["http://localhost:3000"];
  const nodeEnv = configService.get<string>("NODE_ENV") ?? "development";

  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "X-Correlation-Id",
      "x-correlation-id",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers",
    ],
    exposedHeaders: ["set-cookie", "x-correlation-id"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      stopAtFirstError: true,
      transform: true,
    }),
  );

  // Swagger only in development
  if (nodeEnv !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("MottLarbe Dosham API")
      .setDescription("API documentation for the MottLarbe Dosham platform")
      .setVersion("1.0")
      .addBearerAuth({
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        in: "header",
        name: "Authorization",
        description: 'Provide your JWT access token prefixed with "Bearer"',
      })
      .addServer(`http://localhost:${port}/api`, "Local environment")
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, swaggerDocument, {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: "MottLarbe Dosham API Docs",
    });
  }

  await app.listen(port);

  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  logger.log(`Application is running on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
