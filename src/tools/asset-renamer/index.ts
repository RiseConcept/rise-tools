import { lazy } from "react";
import { defineTool } from "../../core/defineTool";
import { IconRename } from "../../ui/icons";

export default defineTool({
  id: "asset-renamer",
  name: "Asset Renamer",
  description: "Troque um nome em todo um resource: arquivos, .meta, fxmanifest e as referências dentro de .ytyp e .ymap, com prévia e desfazer.",
  icon: IconRename,
  view: lazy(() => import("./AssetRenamer")),
  order: 40,
});
