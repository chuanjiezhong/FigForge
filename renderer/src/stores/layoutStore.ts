import { create } from 'zustand'

interface Panel {
  id: string
  type: 'svg' | 'png' | 'tiff'
  path: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

interface LayoutState {
  panels: Panel[]
  addPanel: (panel: Panel) => void
  removePanel: (id: string) => void
  updatePanel: (id: string, updates: Partial<Panel>) => void
  clearPanels: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  panels: [],
  addPanel: (panel) =>
    set((state) => ({
      panels: [...state.panels, panel],
    })),
  removePanel: (id) =>
    set((state) => ({
      panels: state.panels.filter((p) => p.id !== id),
    })),
  updatePanel: (id, updates) =>
    set((state) => ({
      panels: state.panels.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),
  clearPanels: () => set({ panels: [] }),
}))

