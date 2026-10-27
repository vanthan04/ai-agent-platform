import { Controller, Get } from "@nestjs/common";
import { Public } from "../identity";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }
}
