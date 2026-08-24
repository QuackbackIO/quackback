/** Cloud-only: self-hosted mail never carries a Powered-by footer. */
let showPoweredBy = false

export function setEmailShowPoweredBy(show: boolean): void {
  showPoweredBy = show
}

export function getEmailShowPoweredBy(): boolean {
  return showPoweredBy
}
