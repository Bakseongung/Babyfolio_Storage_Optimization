import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { env } from "./common/env.js";
import { PrismaService } from "./common/prisma.service.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  if (process.env.NODE_ENV === "production") {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }
  app.enableShutdownHooks();
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.enableCors({ origin: env.appOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  if (process.env.NODE_ENV !== "production") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("Family Frame API").setVersion("1.0").build()
    );
    SwaggerModule.setup("api/docs", app, document);
  }

  try {
    await app.get(PrismaService).assertSchemaReady();
    await app.listen(env.port);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`백엔드를 시작하지 못했습니다: ${message}`);
  process.exitCode = 1;
});
