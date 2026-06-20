import type { MateSelAPI } from '../../shared'

declare global {
  interface Window {
    mateselAPI: MateSelAPI
  }
}
