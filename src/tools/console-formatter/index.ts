import { lazy } from "react";
import { defineTool } from "../../core/defineTool";
import { IconConsole } from "../../ui/icons";

export default defineTool({
  id: "console-formatter",
  name: "Console Formatter",
  description: "Pinte mensagens do console do FiveM com cores ^0–^9 ou ANSI, veja o resultado ao vivo e copie o print() pronto.",
  icon: IconConsole,
  view: lazy(() => import("./ConsoleFormatter")),
  backend: false,
  order: 20,
});
