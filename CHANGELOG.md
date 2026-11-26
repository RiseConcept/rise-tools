# Changelog

Todas as mudanças do RISE Tools. Downloads em [Releases](https://github.com/RiseConcept/tools-kit/releases).

## [1.0.0] - 2026-11-25

Primeira versão.

### YCD Editor
- Abre `.ycd` soltos ou pastas inteiras (arrastar e soltar).
- **Visualizar:** dict e animações com busca; copia a anim, o par `"dict", "anim"` ou a lista toda como tabela Lua.
- **Editar:** renomeia o dict e as animações e salva uma cópia nova; o original nunca é alterado.

### Console Formatter
- Cores nativas `^0`–`^9` e ANSI (texto, fundo e estilos) com preview ao vivo.
- Gera o `print("...")` pronto, com modelos de Sucesso, Erro, Aviso e Informação.

### Asset Optimizer
- **Auditar:** memória física de cada `.ytd`, `.ydr`, `.yft` e `.ydd`, destacando os acima de 16 MiB (aviso *oversized asset* do FiveM). Lê milhares de arquivos em milissegundos.
- **Otimizar `.ytd`:** reduz texturas grandes (sem perda quando há mipmaps), DXT5 opaco → DXT1 sem perda, comprime texturas sem compressão e remove dados que nenhuma textura usa.
- Simulação exata antes de gravar, backup automático e **Desfazer**.

### Asset Renamer
- Troca um nome em todo um resource: arquivos, `fxmanifest`, `.meta`/`.xml`/`.json` e as referências por hash dentro de `.ytyp` e `.ymap`.
- Substituir, prefixo ou sufixo; acha só o nome inteiro (`carro` acha `prop_carro_01`, não `scarro`).
- Prévia completa, bloqueio de conflitos, backup e desfazer automático se algo falhar.

### Segurança
Tudo que altera arquivos mostra uma prévia, copia os originais para `Documentos\RISE Tools\backups` antes de mudar e tem **Desfazer**.

### Limitações conhecidas
- Asset Optimizer: `.ydr`/`.yft`/`.ydd` só na auditoria; texturas BC7 sem mipmaps não são reduzidas.
- Asset Renamer: `.ymf`, `.ymt` e arquivos criptografados não são alterados (aparecem nos avisos); pastas não são renomeadas.
