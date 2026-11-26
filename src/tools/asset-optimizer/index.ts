import { lazy } from "react";
import { defineTool } from "../../core/defineTool";
import { IconGauge } from "../../ui/icons";

export default defineTool({
  id: "asset-optimizer",
  name: "Asset Optimizer",
  description: "Veja quanto cada .ytd, .ydr, .yft e .ydd pesa na memória e reduza as texturas com segurança, com backup e desfazer.",
  icon: IconGauge,
  view: lazy(() => import("./AssetOptimizer")),
  order: 30,
});
