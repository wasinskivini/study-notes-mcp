/**
 * PASSO 5.1 — O CLIENTE DE TESTE
 *
 * Os testes não chamam as funções do service.ts diretamente: eles sobem o
 * servidor de verdade e conversam com ele pelo protocolo MCP, exatamente como o
 * VS Code faz. Assim o teste cobre o caminho inteiro (PASSO 1 → 2 → 3 → 4).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// notesDir/dataDir apontam para pastas temporárias: os testes nunca tocam nas
// suas anotações ou dados reais. extraEnv permite testar configurações, como
// INCLUDE_PDF=false.
export async function createTestClient (notesDir: string, dataDir: string, extraEnv: Record<string, string> = {}) {
    // O transporte do lado do cliente: inicia "node src/index.ts" como processo
    // filho e fala com ele por stdin/stdout (o mesmo stdio do PASSO 1.1).
    // Com TEST_DIST=1 (no CI, depois do npm run build) os mesmos testes rodam
    // contra o JavaScript compilado que vai para o npm.
    const transport = new StdioClientTransport({
        command: 'node',
        args: [process.env.TEST_DIST ? 'dist/index.js' : 'src/index.ts'],
        env: {
            ...process.env as Record<string, string>,
            NOTES_DIR: notesDir,
            DATA_DIR: dataDir,
            ...extraEnv,
        }
    })

    const client = new Client({
        name: 'test-client',
        version: '1.0.1'
    }, {
        capabilities: {}
    })

    // connect faz o handshake (initialize). Depois disso dá para chamar
    // client.callTool, client.readResource, client.getPrompt...
    await client.connect(transport)
    return client
}

// ----------------------------------------------------------------------------
// As respostas como o MODELO as recebe: só texto. O servidor não manda
// structuredContent (veja o PASSO 2.3), então os testes leem o mesmo texto que
// chega ao modelo e o transformam de volta em listas para comparar.
// ----------------------------------------------------------------------------
type Resposta = { content: { text: string }[] }
const textoDe = (resposta: Resposta) => resposta.content[0].text

// As linhas de dentro do bloco <dados_nao_confiaveis> (nenhuma, se não houver bloco).
export function linhasDoBloco(texto: string): string[] {
    const bloco = texto.match(/<dados_nao_confiaveis id="([0-9a-f]+)">\n([\s\S]*?)\n<\/dados_nao_confiaveis id="\1">/)
    return bloco ? bloco[2].split('\n') : []
}

// buscar_material: "arquivo (p. N):linha — trecho" ou, para trecho achado por
// significado, "arquivo:linha (por significado, similaridade X)" e o trecho nas
// linhas seguintes. "[⚠️] " no começo marca trecho suspeito.
export type ResultadoNoTexto = { arquivo: string; linha: number; pagina?: number; trecho: string; suspeito: boolean; porSignificado: boolean }
const CABECALHO = /^(\[⚠️\] )?(.+?)(?: \(p\. (\d+)\))?:(\d+)(?: — (.*)| \(por significado, similaridade [\d.]+\))$/
export function resultadosDe(resposta: Resposta): ResultadoNoTexto[] {
    const resultados: ResultadoNoTexto[] = []
    for (const linha of linhasDoBloco(textoDe(resposta))) {
        const partes = linha.match(CABECALHO)
        const anterior = resultados.at(-1)
        if (partes) {
            resultados.push({
                arquivo: partes[2], linha: Number(partes[4]), pagina: partes[3] ? Number(partes[3]) : undefined,
                trecho: partes[5] ?? '', suspeito: Boolean(partes[1]), porSignificado: partes[5] === undefined,
            })
        } else if (anterior?.porSignificado) {
            anterior.trecho += (anterior.trecho ? '\n' : '') + linha
        }
    }
    return resultados
}

// listar_arquivos: "arquivo (tipo, N KB)" e, no topo, "N arquivo(s) — ...".
export function arquivosDe(resposta: Resposta): { arquivo: string; tipo: string; kb: number }[] {
    return linhasDoBloco(textoDe(resposta)).flatMap(linha => {
        const partes = linha.match(/^(.+) \((anotacoes|pdf|codigo), (\d+) KB\)$/)
        return partes ? [{ arquivo: partes[1], tipo: partes[2], kb: Number(partes[3]) }] : []
    })
}
export function totalDe(resposta: Resposta): number {
    return Number(textoDe(resposta).match(/^(\d+) arquivo\(s\)/m)?.[1])
}

// listar_modulos: um módulo por linha; as subpastas, recuadas, com o caminho completo.
export function modulosDe(resposta: Resposta): { modulos: string[]; submodulos: Record<string, string[]> } {
    const modulos: string[] = []
    const submodulos: Record<string, string[]> = {}
    for (const linha of textoDe(resposta).split('\n\n')[0].split('\n')) {
        if (!linha || linha === 'Nenhum módulo encontrado') continue
        const pai = modulos.at(-1)
        if (linha.startsWith('  ') && pai) (submodulos[pai] ??= []).push(linha.trim().slice(pai.length + 1))
        else modulos.push(linha)
    }
    return { modulos, submodulos }
}

// ver_estudos: "- #N [modulo] texto (registrada em AAAA-MM-DD)" e "- modulo: aula, aula".
export function duvidasDe(resposta: Resposta): { numero: number; modulo: string; texto: string }[] {
    return linhasDoBloco(textoDe(resposta)).flatMap(linha => {
        const partes = linha.match(/^- #(\d+) \[(.+?)\] (.*) \(registrada em \d{4}-\d{2}-\d{2}\)$/)
        return partes ? [{ numero: Number(partes[1]), modulo: partes[2], texto: partes[3] }] : []
    })
}
export function progressoDe(resposta: Resposta): Record<string, string[]> {
    const linhas = linhasDoBloco(textoDe(resposta))
    const progresso: Record<string, string[]> = {}
    for (const linha of linhas.slice(linhas.indexOf('Aulas concluídas:') + 1)) {
        const partes = linha.match(/^- (.+): (.*)$/)
        if (partes) progresso[partes[1]] = partes[2].split(', ')
    }
    return progresso
}
