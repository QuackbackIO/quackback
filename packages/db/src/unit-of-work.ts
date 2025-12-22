import { db, type Database } from './client'
import {
  PostRepository,
  BoardRepository,
  VoteRepository,
  StatusRepository,
  TagRepository,
  CommentRepository,
  MemberRepository,
} from './repositories'

/**
 * Unit of Work pattern for managing database transactions.
 * Provides lazy-loaded repository accessors.
 */
export class UnitOfWork {
  constructor(private tx: Database) {}

  /**
   * Expose the raw transaction for migration purposes and direct database access.
   * As repositories are created, they will be added as lazy-loaded properties.
   */
  get db(): Database {
    return this.tx
  }

  // Lazy-loaded repository instances
  private _posts?: PostRepository
  private _boards?: BoardRepository
  private _votes?: VoteRepository
  private _statuses?: StatusRepository
  private _tags?: TagRepository
  private _comments?: CommentRepository
  private _members?: MemberRepository

  // Repository accessors
  get posts(): PostRepository {
    if (!this._posts) {
      this._posts = new PostRepository(this.tx)
    }
    return this._posts
  }

  get boards(): BoardRepository {
    if (!this._boards) {
      this._boards = new BoardRepository(this.tx)
    }
    return this._boards
  }

  get votes(): VoteRepository {
    if (!this._votes) {
      this._votes = new VoteRepository(this.tx)
    }
    return this._votes
  }

  get statuses(): StatusRepository {
    if (!this._statuses) {
      this._statuses = new StatusRepository(this.tx)
    }
    return this._statuses
  }

  get tags(): TagRepository {
    if (!this._tags) {
      this._tags = new TagRepository(this.tx)
    }
    return this._tags
  }

  get comments(): CommentRepository {
    if (!this._comments) {
      this._comments = new CommentRepository(this.tx)
    }
    return this._comments
  }

  get members(): MemberRepository {
    if (!this._members) {
      this._members = new MemberRepository(this.tx)
    }
    return this._members
  }
}

/**
 * Executes a callback within a Unit of Work transaction.
 *
 * @param callback - Async function that receives the UnitOfWork instance
 * @returns The result of the callback
 * @throws Error if transaction fails
 *
 * @example
 * ```typescript
 * const result = await withUnitOfWork(async (uow) => {
 *   // Use repositories
 *   const post = await uow.posts.findById(postId)
 *   const board = await uow.boards.findById(boardId)
 *   await uow.votes.create({ postId, userId })
 *
 *   // Or use raw db access if needed
 *   const posts = await uow.db.query.posts.findMany()
 *   return posts
 * })
 * ```
 */
export async function withUnitOfWork<T>(callback: (uow: UnitOfWork) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const uow = new UnitOfWork(tx as unknown as Database)
    return callback(uow)
  })
}
