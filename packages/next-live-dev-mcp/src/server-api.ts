import { RpcTarget } from 'capnweb'
import type { ConsolePayload, ErrorPayload, NetworkPayload } from './core/types.js'
import type { ConsoleWriter } from './core/writers/console.js'
import type { ErrorsWriter } from './core/writers/errors.js'
import type { NetworkWriter } from './core/writers/network.js'

/**
 * ServerApi - RPC interface exported by server, called by browser
 *
 * Browser gets a stub to this and calls methods to send events.
 * Methods are one-way (fire-and-forget) - browser doesn't wait for response.
 */
export class ServerApi extends RpcTarget {
  constructor(
    private consoleWriter: ConsoleWriter | null,
    private errorsWriter: ErrorsWriter | null,
    private networkWriter: NetworkWriter | null = null,
  ) {
    super()
  }

  /**
   * Called by browser when console.log/warn/error/etc is invoked
   * Wave 1 implementation
   */
  onConsole(data: ConsolePayload): void {
    if (this.consoleWriter) {
      this.consoleWriter.write(data)
    }
  }

  /**
   * Called by browser when unhandled errors/rejections occur
   * Wave 2 implementation
   */
  onError(data: ErrorPayload): void {
    if (this.errorsWriter) {
      this.errorsWriter.write(data)
    }
  }

  /**
   * Called by browser when fetch/XHR requests complete
   * Wave 3 implementation
   */
  onNetwork(data: NetworkPayload): void {
    if (this.networkWriter) {
      this.networkWriter.write(data)
    }
  }
}
