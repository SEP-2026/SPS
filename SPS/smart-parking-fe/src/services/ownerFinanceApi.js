import API from "./api";

export async function fetchOwnerBalance() {
  const res = await API.get("/owner/balance");
  return res.data;
}

export async function fetchBankAccounts() {
  const res = await API.get("/owner/bank-accounts");
  return res.data?.accounts || [];
}

export async function createBankAccount(payload) {
  const res = await API.post("/owner/bank-accounts", payload);
  return res.data?.account;
}

export async function updateBankAccount(accountId, payload) {
  const res = await API.patch(`/owner/bank-accounts/${accountId}`, payload);
  return res.data?.account;
}

export async function deleteBankAccount(accountId) {
  await API.delete(`/owner/bank-accounts/${accountId}`);
}

export async function fetchWithdrawals(params = {}) {
  const res = await API.get("/owner/withdrawals", { params });
  return res.data;
}

export async function createWithdrawal(payload) {
  const res = await API.post("/owner/withdrawals", payload);
  return res.data?.withdrawal;
}

export async function cancelWithdrawal(withdrawalId) {
  const res = await API.patch(`/owner/withdrawals/${withdrawalId}/cancel`);
  return res.data?.withdrawal;
}
