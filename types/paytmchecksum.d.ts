declare module 'paytmchecksum' {
  class PaytmChecksum {
    static generateSignature(
      params: string | Record<string, any>,
      key: string
    ): Promise<string>
    static verifySignature(
      params: string | Record<string, any>,
      key: string,
      checksum: string
    ): Promise<boolean>
  }
  export default PaytmChecksum
}
