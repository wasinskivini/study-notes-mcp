/**
 * PASSO 5.5b — VÁRIOS SERVIDORES COM O MESMO DATA_DIR (PASSO 6.4b)
 *
 * Cada cliente abre o próprio servidor, e todos usam o mesmo índice. Estes
 * testes sobem servidores de verdade, com o modelo, e conferem pelo log
 * (stderr) quem carregou o modelo e quem processou os arquivos:
 *   - dois ao mesmo tempo: só um indexa; o outro espera e aproveita;
 *   - uma trava abandonada (dono encerrado ou sem sinal) não segura ninguém;
 *   - com o índice em dia, o modelo só é carregado na primeira busca.
 * Precisa do modelo, por isso roda com npm run test:semantic.
 */
import { describe, it, after, before } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const MODELS_DIR = process.env.MODELS_DIR ?? join(tmpdir(), 'study-notes-mcp-modelos')
const MODELO_CARREGADO = /Modelo da busca por significado carregado/g

// Um servidor com o stderr guardado, para o teste ler o log.
async function subir(notesDir: string, dataDir: string) {
    const transport = new StdioClientTransport({
        command: 'node',
        args: [process.env.TEST_DIST ? 'dist/index.js' : 'src/index.ts'],
        env: { ...process.env as Record<string, string>, NOTES_DIR: notesDir, DATA_DIR: dataDir, SEMANTIC_SEARCH: 'true', MODELS_DIR },
        stderr: 'pipe',
    })
    let log = ''
    transport.stderr?.on('data', parte => { log += String(parte) })
    const client = new Client({ name: 'teste-trava', version: '1.0.0' })
    await client.connect(transport)
    return {
        client,
        log: () => log,
        // Espera uma linha do log aparecer (ou desiste no prazo).
        async esperar(padrao: RegExp, prazoMs = 150_000) {
            const fim = Date.now() + prazoMs
            while (!padrao.test(log)) {
                if (Date.now() > fim) throw new Error(`não apareceu ${padrao} no log:\n${log}`)
                await new Promise(resolve => setTimeout(resolve, 200))
            }
            return log.match(padrao)!
        },
    }
}

const PRONTO = /Índice semântico pronto: (\d+) arquivo\(s\), (\d+) processado\(s\) agora/

// O log "pronto" sai um instante antes de a trava ser apagada: espera ela sumir.
async function semTrava(trava: string, prazoMs = 15_000) {
    const fim = Date.now() + prazoMs
    while (await stat(trava).then(() => true, () => false)) {
        if (Date.now() > fim) throw new Error(`a trava continua lá: ${trava}`)
        await new Promise(resolve => setTimeout(resolve, 100))
    }
}

describe('busca semântica: vários servidores', () => {
    let root: string
    let notesDir: string
    const abertos: Client[] = []

    before(async () => {
        root = await mkdtemp(join(tmpdir(), 'study-notes-trava-'))
        notesDir = join(root, 'notas')
        await cp('tests/fixtures/notas', notesDir, { recursive: true })
        await writeFile(join(notesDir, 'modulo01', 'receita.md'), 'Bolo de cenoura: misture farinha, ovos, açúcar e asse por 40 minutos.')
    })

    after(async () => {
        await Promise.all(abertos.map(client => client.close()))
        await rm(root, { recursive: true, force: true })
    })

    it('should let only one of two servers started together build the index', { timeout: 300_000 }, async () => {
        const dataDir = join(root, 'data-dois')
        const servidores = await Promise.all([subir(notesDir, dataDir), subir(notesDir, dataDir)])
        abertos.push(...servidores.map(s => s.client))
        const prontos = await Promise.all(servidores.map(s => s.esperar(PRONTO)))
        const processados = prontos.map(m => Number(m[2])).sort((a, b) => a - b)
        // Um processou tudo; o outro esperou e aproveitou (0 processados).
        assert.strictEqual(processados[0], 0, servidores.map(s => s.log()).join('\n---\n'))
        assert.ok(processados[1] > 0)
        // Só um carregou o modelo.
        assert.strictEqual(servidores.map(s => s.log().match(MODELO_CARREGADO)?.length ?? 0).reduce((a, b) => a + b), 1)
        // A trava some quando os dois terminam.
        await semTrava(join(dataDir, 'indice-semantico.trava'))

        // O que esperou responde por significado com o índice do outro.
        const busca = await servidores[0].client.callTool({ name: 'buscar_material', arguments: { consulta: 'como funciona o treinamento de uma rede neural?' } }) as { content: { text: string }[] }
        assert.match(busca.content[0].text, /redes-neurais\.md/)
        assert.doesNotMatch(busca.content[0].text, /em construção/)
    })

    it('should load the model only on the first search when the index is up to date', { timeout: 120_000 }, async () => {
        // Mesmo DATA_DIR do teste anterior: o índice já está pronto.
        const servidor = await subir(notesDir, join(root, 'data-dois'))
        abertos.push(servidor.client)
        const [, , processados] = await servidor.esperar(PRONTO)
        assert.strictEqual(Number(processados), 0)
        assert.doesNotMatch(servidor.log(), MODELO_CARREGADO)
        const busca = await servidor.client.callTool({ name: 'buscar_material', arguments: { consulta: 'receita de bolo' } }) as { content: { text: string }[] }
        assert.match(busca.content[0].text, /receita\.md/)
        assert.match(servidor.log(), MODELO_CARREGADO)
    })

    it('should not wait for a lock whose owner is gone or silent', { timeout: 120_000 }, async () => {
        // Dono encerrado: o pid de um processo que já terminou.
        const encerrado = spawnSync(process.execPath, ['-e', '']).pid
        // Dono sem sinal: o pid de um processo vivo (este), mas sem regravar há 5 min.
        const casos: [string, number, boolean][] = [['data-dono-encerrado', encerrado, false], ['data-sem-sinal', process.pid, true]]
        for (const [pasta, pid, antiga] of casos) {
            const dataDir = join(root, pasta)
            await mkdir(dataDir, { recursive: true })
            const trava = join(dataDir, 'indice-semantico.trava')
            await writeFile(trava, JSON.stringify({ pid, feitos: 1, total: 99 }))
            if (antiga) await utimes(trava, new Date(Date.now() - 300_000), new Date(Date.now() - 300_000))
            const inicio = Date.now()
            const servidor = await subir(notesDir, dataDir)
            abertos.push(servidor.client)
            const [, , processados] = await servidor.esperar(PRONTO)
            assert.ok(Number(processados) > 0, pasta)
            // Sem esperar os 60 s de uma trava vencida, nem os 30 min de espera máxima.
            assert.ok(Date.now() - inicio < 55_000, `${pasta}: ${Date.now() - inicio} ms`)
            await semTrava(trava)
        }
    })
})
