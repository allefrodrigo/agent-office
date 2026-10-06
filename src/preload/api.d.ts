import type { OfficeAPI } from '../shared/types'

declare global {
  interface Window {
    office: OfficeAPI
  }
}
