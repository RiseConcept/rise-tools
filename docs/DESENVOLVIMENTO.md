# RISE Tools: desenvolvimento

Tauri 2 + React 19 + TypeScript + Rust. Visual segue o `STYLE-NPV.md` da RISE.

## Rodar e gerar o instalador

```powershell
npm install
npm run tauri dev      # use PowerShell: no Git Bash, o `link` do Git tapa o link.exe do MSVC
npm run tauri build    # gera .exe, .msi e setup.exe em src-tauri/target/release
```

Ícone: a fonte é `assets/app-icon.png` (símbolo da RISE). Para trocar, substitua o arquivo e rode
`npx tauri icon assets/app-icon.png` (depois apague `src-tauri/icons/android` e `ios`).

Requer Rust (MSVC) e o Visual Studio Build Tools com "Desenvolvimento para desktop com C++".

## Arquitetura modular

Cada ferramenta é independente nos dois lados. O front fala com qualquer uma pelo mesmo
comando (`tool_invoke(tool, action, payload)`); o núcleo isola falhas, então um módulo com
bug devolve erro sem derrubar o app nem as outras ferramentas.

```
src-tauri/src/
  tool.rs                 núcleo: trait Tool, Registry, despacho e isolamento
  modules/mod.rs          lista de módulos instalados
  modules/<id>/mod.rs     back-end de cada ferramenta
src/
  core/defineTool.ts      contrato de ferramenta do front
  core/tools.ts           descoberta automática + cliente (toolClient)
  tools/<id>/index.ts     registro da ferramenta (nome, ícone, tela)
  tools/<id>/*.tsx        tela da ferramenta
```

### Adicionar uma ferramenta

1. **Back-end:** crie `src-tauri/src/modules/minha_tool/mod.rs` com uma struct que implementa
   `Tool` (`manifest()` com `id`, `version`, `actions`; `invoke(action, payload)`). Em
   `modules/mod.rs`, adicione `pub mod minha_tool;` e `Arc::new(minha_tool::MinhaTool)` em `all()`.
2. **Front:** crie `src/tools/minha-tool/index.ts` exportando `defineTool({ id: "minha-tool", ... })`
   com o mesmo `id`. Ela aparece no menu e no início sozinha. Na tela, use
   `const call = toolClient("minha-tool")` e `await call("acao", dados)`.
3. Ferramenta só de front? Use `backend: false` e pule o passo 1.

**Remover:** apague as duas pastas e as duas linhas em `modules/mod.rs`.

## YCD Editor

Port de `Tools/Rename YCD/ycd_anims.py`: lista e renomeia o dict e as anims de `.ycd`.
Sempre salva uma cópia (`<dict>.ycd` ou `<dict>_novo.ycd`), nunca sobrescreve, e relê o
arquivo salvo para conferir. Saída verificada byte a byte contra o script Python.

Teste com um arquivo real: `$env:YCD_SAMPLE="C:\...\arquivo.ycd"; cargo test --lib -- --nocapture`

## Asset Optimizer

Audita `.ytd/.ydr/.yft/.ydd` (lê só o cabeçalho de 16 bytes, então é instantâneo) e otimiza `.ytd` em Rust, sem Python:

- reduz texturas acima do tamanho máximo descartando mipmaps (sem perda); só reamostra quando não há mipmaps;
- DXT5/DXT3 opaco → DXT1 bloco a bloco (sem perda);
- A8R8G8B8/X8R8G8B8/A8B8G8R8 → DXT1/DXT5;
- remove pixels órfãos (sobras do OpenIV) quando nenhum ponteiro do arquivo aponta para eles.

Cada arquivo é montado em memória, relido para conferência, copiado para `Documentos\RISE Tools\backups\<data>` e só então trocado (gravação temporária + rename). "Desfazer" restaura o backup.

Testes com arquivos reais (somente leitura no corpus; o e2e escreve na pasta indicada, use uma cópia):

```powershell
$env:YTD_DIR="C:\pasta\com\ytd"; $env:E2E_DIR="C:\copia\descartavel"
cargo test --release --manifest-path src-tauri/Cargo.toml -- --nocapture
```

## Asset Renamer

Troca um nome em todo um resource, de forma consistente:

- renomeia arquivos (qualquer tipo; `fxmanifest.lua`/`__resource.lua` nunca);
- atualiza `.meta`, `.xml`, `.json` e o fxmanifest (texto); `.lua`/`.js` só com a opção ligada;
- troca os hashes (joaat) dos nomes dentro de `.ytyp` e `.ymap` no lugar, sem converter para XML;
- avisa sobre `.ymf`/`.ymt` que citam os nomes, arquivos criptografados e Asset Escrow (`.fxap`).

Regra padrão: sem diferenciar maiúsculas e só como parte separada do nome (`carro` acha `prop_carro_01`, não `scarro`).
Prévia completa antes de gravar; conflitos bloqueiam. Backup em `Documentos\RISE Tools\backups\renamer_<data>`;
se algo falhar no meio, tudo é desfeito sozinho.

```powershell
$env:RENAME_DIR="C:\copia\descartavel\resource"; $env:RENAME_FIND="antigo"; $env:RENAME_TO="novo"
cargo test --release --manifest-path src-tauri/Cargo.toml asset_renamer -- --nocapture
```
