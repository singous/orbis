import { create } from "zustand";

type NotesUiState = {
  selectedNoteId: string | null;
  setSelectedNoteId: (noteId: string | null) => void;
};

export const useNotesUiStore = create<NotesUiState>((set) => ({
  selectedNoteId: null,
  setSelectedNoteId: (selectedNoteId) => set({ selectedNoteId }),
}));
