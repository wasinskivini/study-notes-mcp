/**
 * PASSO 5.5 — TESTES DA BUSCA SEMÂNTICA (PASSO 6), COM O MODELO DE VERDADE
 *
 * Sobe o servidor com SEMANTIC_SEARCH=true. Baixa o modelo (~310 MB) na
 * primeira vez, por isso o arquivo não termina em .test.ts: npm test não o
 * pega, só npm run test:semantic.
 */
import { describe, it, after, before } from 'node:test'
import assert from 'node:assert'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client'
import { createTestClient, resultadosDe } from './helpers.ts'
import { buildPdf } from './pdf.ts'

describe('busca semântica: com modelo', () => {
    let client: Client
    let root: string
    let notesDir: string
    const modelsDir = process.env.MODELS_DIR ?? join(tmpdir(), 'study-notes-mcp-modelos')

    before(async () => {
        root = await mkdtemp(join(tmpdir(), 'study-notes-semantic-'))
        notesDir = join(root, 'notas')
        await cp('tests/fixtures/notas', notesDir, { recursive: true })
        await writeFile(join(notesDir, 'modulo01', 'receita.md'), 'Bolo de cenoura: misture farinha, ovos, açúcar e asse por 40 minutos.')
        await writeFile(join(notesDir, 'modulo01', 'aula-rag.pdf'), buildPdf([
            ['Introducao ao curso'],
            ['Embeddings convertem frases em listas de numeros que capturam o significado'],
        ]))
        // MODELS_DIR fora da pasta temporária: o modelo é baixado uma vez e reaproveitado.
        client = await createTestClient(notesDir, join(root, 'data'), { SEMANTIC_SEARCH: 'true', MODELS_DIR: modelsDir })
    })

    after(async () => {
        await client?.close()
        await rm(root, { recursive: true, force: true })
    })

    // Espera o índice ficar pronto (sem o aviso "em construção").
    async function buscar(pergunta: string, extra: Record<string, unknown> = {}, cliente = client) {
        for (let tentativa = 0; tentativa < 240; tentativa++) {
            const result = await cliente.callTool({ name: 'buscar_material', arguments: { consulta: pergunta, ...extra } }) as any
            if (result.isError) throw new Error(result.content[0].text)
            if (!/em construção/.test(result.content[0].text)) return result
            await new Promise(resolve => setTimeout(resolve, 500))
        }
        throw new Error('índice não ficou pronto a tempo')
    }

    it('should find content by meaning, without the same words', { timeout: 180_000 }, async () => {
        const result = await buscar('como transformar texto em vetores numéricos?')
        const [primeiro] = resultadosDe(result)
        assert.strictEqual(primeiro.arquivo, join('modulo01', 'aula-rag.pdf'))
        assert.strictEqual(primeiro.pagina, 2)
        assert.match(result.content[0].text, /<dados_nao_confiaveis/)
    })

    it('should report the index as ready in estudos://indice', { timeout: 180_000 }, async () => {
        await buscar('embeddings')
        const { contents } = await client.readResource({ uri: 'estudos://indice' })
        const indice = JSON.parse((contents[0] as { text: string }).text)
        assert.strictEqual(indice.ligada, true)
        assert.strictEqual(indice.estado, 'pronto')
        assert.strictEqual(indice.progresso.feitos, indice.progresso.total)
        assert.ok(indice.arquivosNoIndice >= 2 && indice.trechos >= indice.arquivosNoIndice)
        assert.ok(!Number.isNaN(Date.parse(indice.atualizadoEm)))
        assert.strictEqual(indice.erro, undefined)
    })

    it('should rank unrelated content lower', { timeout: 60_000 }, async () => {
        const result = await buscar('receita de bolo')
        assert.strictEqual(resultadosDe(result)[0].arquivo, join('modulo01', 'receita.md'))
    })

    it('should restrict by type', { timeout: 60_000 }, async () => {
        const result = await buscar('embeddings', { tipos: ['anotacoes'] })
        assert.ok(resultadosDe(result).every((r: { arquivo: string }) => !r.arquivo.endsWith('.pdf')))
    })

    // Com o modelo já em MODELS_DIR (baixado no before), nada vai à rede. O
    // tests/sem-rede.cjs faz todo acesso à rede falhar, como sem internet.
    // Antes, o carregamento consultava o Hugging Face e falhava sem internet.
    it('should load the downloaded model without internet', { timeout: 120_000 }, async () => {
        const semRede = await createTestClient(notesDir, join(root, 'data-sem-rede'), {
            SEMANTIC_SEARCH: 'true',
            MODELS_DIR: modelsDir,
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=./tests/sem-rede.cjs`.trim(),
        })
        try {
            const result = await buscar('como transformar texto em vetores numéricos?', {}, semRede)
            assert.doesNotMatch(result.content[0].text, /não está disponível/)
            const [primeiro] = resultadosDe(result)
            assert.strictEqual(primeiro.arquivo, join('modulo01', 'aula-rag.pdf'))
            assert.strictEqual(primeiro.porSignificado, true)
        } finally {
            await semRede.close()
        }
    })
})
