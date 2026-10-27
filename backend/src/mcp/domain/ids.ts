import { z } from "zod";

export const id = <B extends string>() => z.string().min(1).max(128).brand<B>();
