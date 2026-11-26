import { lazy } from "react";
import { defineTool } from "../../core/defineTool";
import { IconClip } from "../../ui/icons";

export default defineTool({
  id: "ycd-editor",
  name: "YCD Editor",
  description: "Veja e renomeie o dict e as animações de arquivos .ycd sem abrir o OpenIV ou o CodeWalker.",
  icon: IconClip,
  view: lazy(() => import("./YcdEditor")),
  order: 10,
});
