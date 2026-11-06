/** The three listed stocks. Asset ids follow creation order in the deploy script. */
export interface AssetInfo {
  id: number;
  isin: string;
  ticker: string;
  name: string;
  symbol: string;
  yahoo: string;
}

export const ASSETS: AssetInfo[] = [
  { id: 1, isin: "INE002A01018", ticker: "RELIANCE", name: "Reliance Industries", symbol: "bRELIANCE", yahoo: "RELIANCE.NS" },
  { id: 2, isin: "INE467B01029", ticker: "TCS", name: "Tata Consultancy Services", symbol: "bTCS", yahoo: "TCS.NS" },
  { id: 3, isin: "INE009A01021", ticker: "INFY", name: "Infosys", symbol: "bINFY", yahoo: "INFY.NS" },
];

export const assetById = (id: number) => ASSETS.find((a) => a.id === id);
export const assetByIsin = (isin: string) => ASSETS.find((a) => a.isin === isin);
