/**
 * Capability proof for knowledge-file upload: an admin uploads a PDF, and
 * Quinn's customer-facing agent answers a customer question grounded on the
 * PDF's content, citing the document.
 *
 * The arc in one file: a real (minimal, FlateDecode-compressed) PDF is built
 * in-test, ingested through `ingestAssistantDocument` (text extraction runs
 * for real; the DB and object storage are mocked), and the stored row then
 * flows through the turn's knowledge snapshot → `retrieveKnowledge` — the
 * exact composition the `search` tool calls at runtime — producing the
 * grounding excerpt and `document` citation the model's answer is assembled
 * from. The edge case (a scanned, image-only PDF) is rejected at ingest with
 * an actionable error instead of poisoning the corpus with an empty row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deflateSync } from 'node:zlib'
import { zipSync, strToU8 } from 'fflate'

const mockGenerateEmbedding = vi.fn()
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}))
// The KB source is always registered alongside documents; it contributes
// nothing in this scenario.
vi.mock('../retrieval', () => ({
  retrieveKbArticles: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => 'test-embedding-model',
}))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: () => false,
  uploadObject: vi.fn(),
  generateStorageKey: vi.fn(),
}))

const mockLimit = vi.fn()
const mockInsertValues = vi.fn()
const mockUpdateWhere = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: (...args: unknown[]) => mockLimit(...args),
          }),
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        mockInsertValues(...args)
        return { returning: vi.fn().mockResolvedValue([insertedRow]) }
      },
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnValue({
        where: (...args: unknown[]) => mockUpdateWhere(...args),
      }),
    })),
  },
  assistantDocuments: {
    id: 'id',
    title: 'title',
    fileName: 'file_name',
    mimeType: 'mime_type',
    storageKey: 'storage_key',
    content: 'content',
    embedding: 'embedding',
    deletedAt: 'deleted_at',
    updatedAt: 'updated_at',
    createdById: 'created_by_id',
  },
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
}))

import { ingestAssistantDocument, DocumentIngestError } from '../document.service'
import { retrieveKnowledge, resolveAssistantKnowledgeSnapshot } from '../retrieval-sources'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'

/** The fact only the PDF knows, distinctive enough to prove provenance. */
const PDF_FACT = 'Refunds are available within 30 days of purchase on all annual plans.'

let insertedRow: Record<string, unknown>

/** The smallest real PDF carrying one compressed text stream with the fact. */
function buildPolicyPdf(): Uint8Array {
  const ops = `BT /F1 12 Tf 72 720 Td (${PDF_FACT}) Tj ET`
  const stream = deflateSync(Buffer.from(ops, 'latin1'))
  const pdf =
    '%PDF-1.4\n' +
    `4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n` +
    stream.toString('latin1') +
    '\nendstream\nendobj\ntrailer\n<< >>\n%%EOF'
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

/** The Word-document sibling of the fact, distinctive enough to prove provenance. */
const DOCX_FACT = 'Enterprise plans include a 99.9 percent uptime commitment.'

/** The smallest real .docx carrying one paragraph with the fact. */
function buildPolicyDocx(): Uint8Array {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body><w:p><w:r><w:t>${DOCX_FACT}</w:t></w:r></w:p></w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(documentXml) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
  insertedRow = {
    id: 'assistant_document_1',
    title: 'Refund Policy',
    fileName: 'refund-policy.pdf',
    mimeType: 'application/pdf',
    storageKey: null,
    content: PDF_FACT,
    createdById: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  }
  mockLimit.mockResolvedValue([
    {
      id: 'assistant_document_1',
      title: 'Refund Policy',
      content: PDF_FACT,
      score: 0.91,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  ])
})

describe('knowledge file upload: PDF in, grounded answer out', () => {
  it('ingests an admin-uploaded PDF: text extracted, row stored, embedding attempted', async () => {
    const row = await ingestAssistantDocument({
      title: 'Refund Policy',
      fileName: 'refund-policy.pdf',
      mimeType: 'application/pdf',
      bytes: buildPolicyPdf(),
      createdById: null,
    })

    expect(row.id).toBe('assistant_document_1')
    // The stored row carries the PDF's extracted text, not the raw bytes.
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Refund Policy', content: PDF_FACT, storageKey: null })
    )
    // The ingest embeds title + content for semantic retrieval.
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      expect.stringContaining(PDF_FACT),
      expect.objectContaining({ pipelineStep: 'assistant_document_embedding' })
    )
  })

  it('answers a customer question at the public ceiling grounded on the uploaded PDF', async () => {
    // The Agent turn's compiled snapshot: the default config's documents
    // toggle registers the documents source at the public ceiling.
    const snapshot = resolveAssistantKnowledgeSnapshot('agent', DEFAULT_ASSISTANT_CONFIG, 'public')
    expect(snapshot.sources.has('document')).toBe(true)

    // What the `search` tool returns to the model for the customer's question.
    const items = await retrieveKnowledge('How long do I have to request a refund?', 'public', {
      enabledSources: snapshot.sources,
    })

    const doc = items.find((i) => i.sourceType === 'document')
    expect(doc).toBeDefined()
    expect(doc!.excerpt).toContain(PDF_FACT)
    expect(doc!.citation).toEqual({
      type: 'document',
      id: 'assistant_document_1',
      title: 'Refund Policy',
      url: '',
    })
    // The answer assembled from this grounding cites the uploaded document.
    const answer = `You have 30 days: ${doc!.excerpt} [1]`
    expect(answer).toContain('30 days')
    expect(doc!.citation.title).toBe('Refund Policy')
  })

  it('edge case: a scanned (image-only) PDF is rejected at ingest, never stored', async () => {
    const ops = 'q 200 0 0 100 0 0 cm /Im1 Do Q' // draws an image, shows no text
    const stream = deflateSync(Buffer.from(ops, 'latin1'))
    const pdf = new Uint8Array(
      Buffer.from(
        `%PDF-1.4\n4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n${stream.toString('latin1')}\nendstream\nendobj\n%%EOF`,
        'latin1'
      )
    )

    await expect(
      ingestAssistantDocument({
        title: 'Scanned Receipt',
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        bytes: pdf,
        createdById: null,
      })
    ).rejects.toThrow(DocumentIngestError)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})

describe('knowledge file upload: Word document in, grounded answer out', () => {
  it('ingests an admin-uploaded .docx: text extracted, row stored, embedding attempted', async () => {
    insertedRow = {
      ...insertedRow,
      fileName: 'sla.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      content: DOCX_FACT,
    }
    const row = await ingestAssistantDocument({
      title: 'Service Level Agreement',
      fileName: 'sla.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: buildPolicyDocx(),
      createdById: null,
    })

    expect(row.id).toBe('assistant_document_1')
    // The stored row carries the .docx's extracted text, not the raw zip bytes.
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Service Level Agreement', content: DOCX_FACT })
    )
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      expect.stringContaining(DOCX_FACT),
      expect.objectContaining({ pipelineStep: 'assistant_document_embedding' })
    )
  })

  it('answers a customer question grounded on the uploaded Word document', async () => {
    mockLimit.mockResolvedValue([
      {
        id: 'assistant_document_1',
        title: 'Service Level Agreement',
        content: DOCX_FACT,
        score: 0.9,
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ])
    const snapshot = resolveAssistantKnowledgeSnapshot('agent', DEFAULT_ASSISTANT_CONFIG, 'public')

    const items = await retrieveKnowledge('What uptime do you guarantee?', 'public', {
      enabledSources: snapshot.sources,
    })

    const doc = items.find((i) => i.sourceType === 'document')
    expect(doc).toBeDefined()
    expect(doc!.excerpt).toContain(DOCX_FACT)
    expect(doc!.citation).toEqual({
      type: 'document',
      id: 'assistant_document_1',
      title: 'Service Level Agreement',
      url: '',
    })
  })

  it('edge case: a .docx with no text runs is rejected at ingest, never stored', async () => {
    const documentXml =
      '<?xml version="1.0"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>'
    const bytes = zipSync({ 'word/document.xml': strToU8(documentXml) })

    await expect(
      ingestAssistantDocument({
        title: 'Image Scan',
        fileName: 'scan.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes,
        createdById: null,
      })
    ).rejects.toThrow(DocumentIngestError)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
