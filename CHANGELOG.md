# Changelog

As mudanças de cada versão. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/): a versão maior muda quando algo deixa de funcionar como antes (nome de tool, parâmetro, formato dos dados salvos).

## [1.4.1] - 2026-11-17

A descrição do servidor passa a dizer o que ele não faz: alterar o seu material. Nenhuma tool mudou.

### Alterado
- **A descrição deixa claro que o servidor só lê o material.** Pelo nome, o servidor parece um app de notas, e quem o avalia pela lista de tools (diretórios de servidores MCP, como o Glama) sente falta de tools para criar e editar notas. Elas ficam de fora de propósito: nenhuma tool cria, edita ou apaga arquivos da pasta de estudos, e as de escrita gravam só dúvidas e progresso, em `DATA_DIR`. Isso agora está escrito na descrição do npm e do MCP Registry, no README e nas instruções que o servidor manda ao modelo.

### Corrigido
- O `.env.example` dizia que o modelo da busca por significado tem ~145 MB. Desde a 1.3.0, são ~310 MB.

## [1.4.0] - 2026-11-16

Correções encontradas no uso real. À pergunta "o que eu tenho no material sobre o módulo 4?", o Claude Code respondeu abrindo a pasta pelo terminal, em vez de usar o servidor. Com vários clientes abertos, cada um montava o mesmo índice ao mesmo tempo. E a busca por significado precisava de internet toda vez que o modelo era carregado.

### Corrigido
- **As proteções e as dicas não chegavam ao modelo no Claude Code, no VS Code e no Codex.** Quatro tools (`listar_modulos`, `listar_arquivos`, `buscar_material` e `ver_estudos`) respondiam em texto e também em JSON (`structuredContent`). Quando há JSON, esses clientes mandam ao modelo só o JSON e descartam o texto ([Claude Code](https://github.com/anthropics/claude-code/issues/55677), [VS Code](https://github.com/microsoft/vscode/issues/290063), [Codex](https://github.com/openai/codex/issues/38287)).
  - **Era no texto que estavam:** a delimitação `<dados_nao_confiaveis>`, o alerta de prompt injection, o aviso 🔒 de credenciais mascaradas e as dicas ("mostrando 100 de 634", "índice em construção", "limite de 20 resultados").
  - **O que continuava funcionando:** as credenciais seguiam mascaradas, porque isso acontece antes.
  - **Agora:** as tools respondem só em texto, que todos os clientes repassam ao modelo, e um teste garante que nenhuma volte a mandar JSON.
- **A busca por significado não funcionava sem internet**, mesmo com o modelo já baixado.
  - **Por quê:** carregado pelo nome, o modelo fazia a biblioteca consultar o Hugging Face a cada carregamento, para conferir se um arquivo do tokenizer existe (fora da revisão fixada e sem prazo para a resposta).
  - **Efeito:** sem internet, o carregamento falhava e só a busca literal funcionava. Com o site lento, ficava parado; foi o que travou um teste no CI.
  - **Agora:** já baixado, o modelo é lido direto da pasta da revisão fixada em `MODELS_DIR`, sem acesso à rede. Os vetores são os mesmos, e um teste sobe o servidor com a rede bloqueada.

### Alterado
- **`listar_arquivos` com mais de 100 arquivos mostra um panorama**, em vez dos 100 primeiros, que num curso eram só os das primeiras aulas. Numa chamada só, cada subpasta aparece com:
  - quantos arquivos tem, por tipo;
  - o título e o primeiro parágrafo do README (`README.md`, `LEIAME.md`, `index.md` ou `UNIDADE.md`). Esse texto passa pelas mesmas proteções da leitura, e o `.studynotesignore` vale para ele.

  Para ver os arquivos de uma subpasta, o modelo chama a tool de novo com ela. Com até 100 arquivos, a lista continua igual.
- **As instruções do servidor dizem quando preferir as tools** a abrir os arquivos por outro meio: elas leem PDFs, respeitam o `.studynotesignore`, mascaram credenciais e indicam a fonte.
- **Medição:** a mesma pergunta, no Claude Code, sobre o mesmo material (o módulo com 634 arquivos em 13 aulas, mais uma cópia com 1.453).

  | | 1.3.0 | 1.4.0 (duas rodadas) |
  |---|---|---|
  | Chamadas de tool | 25 | 4 |
  | Rodadas | 26 | 6–7 |
  | Tokens de entrada | ~842 mil | ~190–230 mil |
  | Tentativas de usar o terminal | 3 | nenhuma |

  A resposta passou a cobrir o módulo inteiro.
- Quem lia o JSON (`structuredContent`) num programa: ele não existe mais, e o texto traz os mesmos dados.
- **Só um servidor monta o índice de cada vez.** Cada cliente (o VS Code, cada sessão do Claude Code, o Codex) abre o próprio servidor, e todos usam o mesmo índice em `DATA_DIR`. Na primeira indexação, todos calculavam o índice inteiro ao mesmo tempo, cada um com o modelo carregado.
  - **Como funciona agora:** o primeiro cria uma trava (`DATA_DIR/indice-semantico.trava`). Os outros esperam sem carregar o modelo, mostram o progresso dele no aviso da busca e no `estudos://indice` (`feitoPorOutroCliente`) e depois aproveitam o índice salvo.
  - **Se algo der errado:** se a trava não puder ser criada, se quem indexa for encerrado ou parar de dar sinal por 60 s, ou se a espera passar de 30 min, cada servidor indexa sozinho, como antes.
  - **Medição:** 3 servidores abertos ao mesmo tempo na primeira indexação do material real (~1.700 arquivos).

    | | 1.3.0 | 1.4.0 |
    |---|---|---|
    | Até os 3 ficarem prontos | 26,2 min | 5,8 min |
    | Memória somada no pico | 3,6 GB | 2,4 GB |
    | Modelos carregados | 3 | 1 |
    | Busca durante a indexação | 4,9–5,6 s | 0,6–1,7 s |
- **O modelo só é carregado quando há algo para calcular:** arquivos novos ou alterados, ou a primeira busca.
  - **Ganho:** com o índice em dia, um servidor aberto fica com ~0,3 GB até a primeira busca, em vez de ~1,4 GB. Com o servidor configurado para todas as sessões do Claude Code, as sessões que não consultam o material deixam de ocupar ~1 GB cada.
  - **Custo:** a primeira busca de cada sessão leva ~0,6 s a mais (1,3 s em vez de 0,7 s).
  - O log do servidor diz quando o modelo é carregado.

## [1.3.0] - 2026-11-14

Busca por significado bem melhor no material real, escolhida por medição: 48 perguntas sobre um material de curso de verdade, escritas com outras palavras a partir de trechos sorteados, feitas ao servidor pelo protocolo MCP, como um cliente faz.

### Alterado
- **Modelo novo: [snowflake-arctic-embed-m-v2.0](https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0)** (Apache-2.0, multilíngue), no lugar do multilingual-e5-small, e **cada trecho ganha um cabeçalho** com o nome do arquivo e os títulos da seção antes de virar vetor. Arquivo certo em 1º lugar: de 21 para **34** das 48 perguntas; entre os 5 primeiros: de 33 para **44**. Também comparados no mesmo material: e5-base (36 no top 5 só por significado, contra 42 do escolhido) e bge-m3 (36, com o dobro do tamanho e 20 min de indexação). Uma busca por palavras (BM25) junto foi testada e não acrescentou nada, por isso ficou de fora. A busca por nome exato continua igual (6 de 6 na avaliação do repositório).
- **Custos, quase todos de uma vez só:** o modelo baixa ~310 MB (antes ~120 MB); a primeira indexação leva ~6,5 min para ~1.700 arquivos (antes ~2 min), com a busca funcionando enquanto isso; o índice ocupa 58 MB (antes 32 MB). Cada servidor aberto usa ~1,07 GB de memória (antes ~790 MB). O tempo de cada busca não mudou (~0,44 s).
- **O índice é refeito uma vez, sozinho**, na primeira conversa depois de atualizar. O modelo antigo fica em `MODELS_DIR/Xenova` (~120 MB) e pode ser apagado.

### Corrigido
- **Buscas travavam durante a indexação** (passavam de 60 s e o cliente desistia) com o modelo maior: o motor de inferência roda cada lote no thread principal e congela o servidor enquanto calcula. Agora os pedidos do cliente têm prioridade (a indexação pausa entre os lotes enquanto houver um pedido esperando resposta), e os lotes são menores. Medido na reindexação do material real: ~4 s nos primeiros segundos, quando o servidor ainda está carregando o modelo, e ~0,8 s depois.
- O aviso "Unknown model class" que a biblioteca de embeddings escrevia no log a cada início não aparece mais (só erros são registrados).
- **Correção do que foi anunciado na 1.2.0:** o ganho do corte nos títulos (de 26% para 41%) foi medido usando os próprios títulos como perguntas, o que favorecia o método. Em perguntas reais, com o modelo antigo, o efeito ficou dentro do ruído. Com o modelo novo, o corte nos títulos soma +0,04 de MRR, e o cabeçalho, +0,07.

## [1.2.0] - 2026-11-13

A terceira parte da revisão de código externa: buscas mais relevantes (exata e por significado), PDFs mais rápidos e o estado do índice visível. Cada mudança foi medida num material de curso real.

### Adicionado
- Resource `estudos://indice`: o estado da busca por significado (ligada ou não, progresso da indexação, arquivos e trechos no índice e o último erro), sem precisar fazer uma busca.

### Alterado
- **Busca por significado: os trechos começam em cada título Markdown**, para cada um falar de um assunto só. Antes, o corte a cada ~800 caracteres ignorava as seções: num material de curso real, 71% dos trechos misturavam duas. Medido nesse material, usando os títulos das seções como perguntas: o 1º trecho cobre a seção certa em 41% das vezes, contra 26%. Numa avaliação nova, com notas longas e perguntas escritas com outras palavras (`tests/secoes.model.ts`), o 1º trecho começa na seção certa em 13 de 18 perguntas, contra 1 de 18. **O índice é refeito uma vez, sozinho**, na primeira conversa depois de atualizar (~2 min para ~1.700 arquivos), e fica maior (de 26 para 32 MB nesse material). A sobreposição entre trechos também foi testada e não melhorou nada, por isso ficou de fora.
- **O texto dos PDFs fica salvo em `DATA_DIR/cache-pdf.json`** (permissão 600, caminhos relativos): a primeira busca de cada conversa não extrai todos os PDFs de novo. Num material com 57 PDFs, de 1,2 s para 0,4 s; o arquivo ocupa ~270 KB. PDFs alterados são extraídos de novo, e os apagados saem do cache.
- **A busca por texto exato ordena por relevância**, e não mais pela ordem das pastas: conta o termo no nome do arquivo, em título de anotação (`# ...`, fora de blocos de código), como palavra inteira e o número de repetições (com teto); com pontuação parecida, anotações vêm antes de PDFs, e PDFs antes de código. Num material de curso real, buscas como "docker", "MCP" e "embedding" passaram a trazer primeiro a nota sobre o assunto, em vez dos mesmos três READMEs para qualquer termo. Na avaliação, com 5 perguntas novas de termos que aparecem em vários arquivos, a literal foi de 3/5 para 5/5 no 1º lugar, e a híbrida (a da tool) de 20/25 para 22/25 no total: a ordem antiga estava atrapalhando a fusão das duas buscas. Custo: a busca agora percorre todos os arquivos antes de responder (no material medido, de ~0,12 s para ~0,4 s).
- Documentado o comportamento com links simbólicos: a busca os ignora (evita resultados repetidos), e a leitura direta só aceita os que apontam para dentro da pasta de estudos.
- O aviso de índice em construção diz "preparando" em vez de "0 de 0 arquivos" enquanto a lista de arquivos ainda está sendo montada.

## [1.1.1] - 2026-11-13

Manutenção para o projeto seguir estável com pouca intervenção.

### Alterado
- Busca por significado: a versão testada passa a ser a `@huggingface/transformers` 4.3.2 (mesmo motor de inferência, vetores e índice iguais). O servidor aceita qualquer 4.x a partir da 4.3.1, então configurações com `--package=@huggingface/transformers@4.3.1` continuam funcionando sem mudança.
- CI: o macOS roda só com Node 22 (o Node 24 segue testado no Ubuntu e no Windows), por causa da fila longa das máquinas macOS do GitHub. O Dependabot passa a propor atualizações a cada seis meses; correções de segurança continuam imediatas.

## [1.1.0] - 2026-11-13

Melhorias da revisão de código externa: busca, segurança e uma tool nova. Cada uma foi medida num material de curso real antes do merge.

### Adicionado
- Mais segredos mascarados: valores sem aspas (`.env` colado numa nota, frontmatter YAML), JWT, `Bearer`, `x-api-key` e tokens do Hugging Face. Textos de exemplo e referências no código ficam como estão (medido num material real: sem esse filtro, todos os casos novos eram falsos).
- Linha 🔒 quando algo com cara de credencial foi mascarado, separada do alerta de *prompt injection*. Na busca por significado, o mascaramento é refeito na resposta, cobrindo índices gerados por versões anteriores.
- Tool `listar_arquivos`: os arquivos de um módulo, com tipo e tamanho (até 100, com filtro por tipo). O `gerar_quiz` passa a listar o módulo antes de ler, em vez de depender de termos de busca adivinhados.

### Alterado
- Mais variações de *prompt injection* geram alerta: palavras entre "ignore" e "anteriores", "desconsidere o que foi dito antes", pedidos do prompt de sistema, ordens para chamar uma tool do servidor e para expor o `.env`. Medido num material de curso real: os alertas passaram de 4 para 8 linhas, todas com frases de ataque de verdade, e dúvidas legítimas como "posso ignorar o aviso acima?" continuam aceitas.
- A busca por texto exato não diferencia mais acentos: `funcao` acha "função", e `ativação` acha também onde está escrito "ativacao". O trecho devolvido mantém os acentos originais.

## [1.0.2] - 2026-11-13

Correções vindas de uma revisão de código externa, todas reproduzidas antes de corrigir e cobertas por teste.

### Corrigido
- **Dúvidas perdidas em chamadas simultâneas:** registrar três dúvidas em paralelo gravava só uma, e uma delas respondia "sucesso" sem ter sido gravada. As gravações agora entram numa fila por arquivo.
- **Uma subpasta ilegível derrubava a busca e a lista de módulos inteiras.** Agora ela é pulada, com aviso no log. Um módulo que é um arquivo recebe uma explicação, em vez de `ENOTDIR`.
- **Caminhos absolutos (com o nome do usuário) em mensagens de erro:** nenhuma saída leva mais caminhos ao modelo, incluindo os erros de prompts e resources e o aviso da busca por significado.
- **O trecho da busca literal podia não conter o termo** numa linha longa. Agora ele fica centrado no termo, e os segredos são mascarados antes do recorte (recortando antes, uma chave no ponto do corte vazava sem o prefixo).
- **Parágrafos maiores que um trecho** eram lidos só no começo pela busca por significado. Agora viram vários trechos; os trechos das outras linhas não mudam, então os índices salvos continuam valendo.
- Itens menores: intervalo de páginas inválido, vetores de tamanhos diferentes, alinhamento na leitura do índice e aviso para linhas com `!` no `.studynotesignore`.

### Adicionado
- A versão aparece no log de inicialização, e `npx -y study-notes-mcp@latest --version` mostra a versão.

### Documentação
- README com a seção "Por que este servidor", e descrição e palavras-chave do npm destacando a busca híbrida local e sem chave de API.

## [1.0.1] - 2026-11-12

### Documentação
- README sem o aviso de projeto educacional, e exemplos de pasta com um nome genérico (`Estudos`).

### Publicação
- Primeira versão publicada pelo GitHub Actions, com *provenance*: a página do npm mostra de qual commit e de qual workflow o pacote saiu.
- O CI e a publicação instalam as dependências sem os scripts de instalação, exceto no teste da busca por significado: uma falha no servidor de download do `onnxruntime-node` não derruba mais uma release.

## [1.0.0] - 2026-11-12

Primeira versão publicada.

### Tools, prompts e resources
- `buscar_material`: busca por nome exato e, com `SEMANTIC_SEARCH=true`, por significado. As duas buscas são unidas (*Reciprocal Rank Fusion*), e cada resultado cita arquivo, linha e página.
- `ler_material`: lê anotações, código e PDFs por página. Em notas do Obsidian, mostra para onde cada `[[link]]` aponta.
- `listar_modulos`, incluindo os módulos dentro de outra pasta (como num repositório de curso clonado).
- `registrar_duvida`, `resolver_duvida`, `marcar_aula_concluida` e `ver_estudos`.
- Prompts `gerar_quiz` (com autocompletar do módulo e busca pelo número ou trecho do nome) e `plano_de_revisao`, ambos pedindo a fonte de cada resposta.
- Resources `estudos://duvidas` e `estudos://progresso`.

### Material
- Anotações (`.md`, `.txt`), PDFs com texto e código (`.ts`, `.js`, `.py` e outros).
- Arquivo `.studynotesignore`, no formato do `.gitignore`, para excluir pastas e arquivos.
- Busca por significado local, com o modelo `multilingual-e5-small`: sem chave de API, textos repetidos calculados uma vez só.

### Segurança
- Lista fechada de extensões, bloqueio de arquivos ocultos, de `../` e de symlinks para fora da pasta.
- Segredos trocados por `[REDACTED]`, alertas de *prompt injection* e conteúdo delimitado como dado não confiável.
- Recusa igual para arquivos bloqueados que existem ou não, e mensagens de erro sem caminhos absolutos.
- Gravação atômica das dúvidas, do progresso e do índice, com novas tentativas no Windows; um arquivo ilegível nunca é sobrescrito.

### Requisitos
- Node.js 22.18 ou mais novo.

### Clientes testados
- VS Code com GitHub Copilot, Claude Code e Codex. Detalhes em [docs/clientes.md](docs/clientes.md).

[1.4.0]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.4.0
[1.3.0]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.3.0
[1.2.0]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.2.0
[1.1.1]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.1.1
[1.1.0]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.1.0
[1.0.2]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.0.2
[1.0.1]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/wasinskivini/study-notes-mcp/releases/tag/v1.0.0
