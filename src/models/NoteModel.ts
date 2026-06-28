export interface NoteModel {
  id: string
  noteName: string
  content: string
  createdAt: string
  updatedAt: string
  isLocked: boolean
  passwordHash?: string
  favorite: boolean
  deleted: boolean
}
