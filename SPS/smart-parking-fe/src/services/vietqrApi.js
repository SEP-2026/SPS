import API from "./api";

export async function fetchVietQrBanks() {
  const res = await API.get("/owner/vietqr/banks");
  return {
    banks: res.data?.banks || [],
    total: res.data?.total || (res.data?.banks || []).length,
  };
}

export async function lookupVietQrAccount({ bankBin, accountNumber }) {
  const res = await API.post("/owner/vietqr/lookup", { bankBin, accountNumber });
  return res.data;
}
