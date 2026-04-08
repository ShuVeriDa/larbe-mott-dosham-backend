import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import * as dotenv from "dotenv";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";

async function bootstrap() {
  dotenv.config();

  const app = await NestFactory.create(AppModule);
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
    credentials: true, // Включение поддержки отправки cookie через CORS
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers",
    ],
    exposedHeaders: ["set-cookie"], // Разрешение клиенту доступа к заголовку 'set-cookie' в ответе сервера
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

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
      .setTitle("MottLarbe API")
      .setDescription("API documentation for the MottLarbe platform")
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
      swaggerOptions: {
        persistAuthorization: true,
      },
      customSiteTitle: "MottLarbe API Docs",
    });

    const httpAdapter = app.getHttpAdapter().getInstance();

    if (typeof httpAdapter.get === "function") {
      httpAdapter.get("/api", (_req: Request, res: Response) => {
        (res as any).redirect("/api/docs");
      });
    }
  }

  await app.listen(port);
  new Logger("Bootstrap").log(
    `Application is running on: http://localhost:${port}`,
  );
}
void bootstrap();
