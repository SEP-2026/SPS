import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Banknote,
  CircleDollarSign,
  Info,
  MoreVertical,
  Percent,
  Plus,
  RefreshCw,
  WalletCards,
  X,
} from "lucide-react";
import { formatCurrency, formatDateTime } from "../OwnerUI";
import { downloadCsv, formatNumber } from "../ownerUtils";
import {
  cancelWithdrawal,
  createBankAccount,
  createWithdrawal,
  fetchBankAccounts,
  fetchWithdrawals,
} from "../../services/ownerFinanceApi";
import { useOwnerRevenueContext } from "./OwnerRevenueLayout";
import { WITHDRAWAL_FEE } from "./revenueUtils";
import {
  ExportReportButton,
  RevenueDateRange,
  RevenuePageActions,
  RevenuePagination,
  RevenueStatGrid,
  RevenueTableTabs,
} from "./OwnerRevenueShared";
import BankAccountModal from "./BankAccountModal";

const TABLE_TABS = [
  { value: "all", label: "Tất cả yêu cầu" },
  { value: "processing", label: "Chờ duyệt" },
  { value: "completed", label: "Đã hoàn thành" },
  { value: "cancelled", label: "Đã hủy" },
];

const STATUS_LABELS = {
  processing: { label: "Chờ duyệt", tone: "info" },
  completed: { label: "Đã hoàn thành", tone: "success" },
  cancelled: { label: "Đã hủy", tone: "danger" },
};

export default function OwnerRevenueWithdrawals() {
  const revenue = useOwnerRevenueContext();
  const { dateFrom, dateTo, setDateFrom, setDateTo, commissionRate } = revenue;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState({ balance: {}, summary: {}, withdrawals: [] });
  const [accounts, setAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [amount, setAmount] = useState("");
  const [bankModal, setBankModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError("");
      setLoading(true);
      const [withdrawalData, bankAccounts] = await Promise.all([
        fetchWithdrawals({
          dateFrom,
          dateTo,
          status: activeTab,
        }),
        fetchBankAccounts(),
      ]);
      setData(withdrawalData);
      setAccounts(bankAccounts);
    } catch (err) {
      setError(err?.response?.data?.detail || "Không tải được dữ liệu rút tiền");
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const balance = data.balance || {};
  const summary = data.summary || {};
  const parsedAmount = Number(String(amount).replace(/\D/g, ""));
  const receivedAmount = parsedAmount > WITHDRAWAL_FEE ? parsedAmount - WITHDRAWAL_FEE : 0;
  const defaultAccount = accounts.find((item) => item.isDefault) || accounts[0];

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (data.withdrawals || []).filter((item) => {
      if (!keyword) {
        return true;
      }
      return [item.requestCode, item.bankAccountLabel, item.accountHolderName, item.status]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [data.withdrawals, search]);

  const visibleRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const statItems = [
    {
      title: "Số dư khả dụng",
      value: formatCurrency(balance.availableBalance),
      icon: <CircleDollarSign size={23} />,
      tone: "blue",
      action: <button type="button" className="owner-revenue-inline-button" onClick={() => document.getElementById("owner-quick-withdraw")?.scrollIntoView({ behavior: "smooth" })}>Rút tiền ngay →</button>,
    },
    {
      title: "Chờ duyệt",
      value: formatCurrency(summary.processingAmount),
      subtitle: `${formatNumber(summary.processingCount || 0)} yêu cầu`,
      icon: <WalletCards size={23} />,
      tone: "green",
    },
    {
      title: "Đã rút trong kỳ",
      value: formatCurrency(summary.periodWithdrawn),
      subtitle: `${formatNumber(summary.periodCount || 0)} giao dịch`,
      icon: <Banknote size={23} />,
      tone: "sky",
    },
    {
      title: "Tổng đã rút",
      value: formatCurrency(summary.totalWithdrawn),
      subtitle: "Tất cả yêu cầu hoàn thành",
      icon: <Percent size={23} />,
      tone: "orange",
    },
    {
      title: "Phí rút tiền",
      value: formatCurrency(WITHDRAWAL_FEE),
      subtitle: `Hoa hồng nền tảng ${commissionRate}%`,
      icon: <WalletCards size={23} />,
      tone: "pink",
    },
  ];

  const exportRows = filtered.map((item) => ({
    ma_yeu_cau: item.requestCode,
    ngay_tao: formatDateTime(item.createdAt),
    so_tien_rut: item.amount,
    phi: item.fee,
    so_nhan: item.netAmount,
    tai_khoan: item.bankAccountLabel,
    trang_thai: item.status,
    cap_nhat: formatDateTime(item.updatedAt),
  }));

  const submitWithdrawal = async () => {
    if (!parsedAmount || parsedAmount < (balance.minWithdrawalAmount || 50000)) {
      window.alert(`Số tiền tối thiểu ${formatCurrency(balance.minWithdrawalAmount || 50000)}`);
      return;
    }
    if (parsedAmount > Number(balance.availableBalance || 0)) {
      window.alert("Số dư khả dụng không đủ.");
      return;
    }
    try {
      setSaving(true);
      await createWithdrawal({
        amount: parsedAmount,
        bankAccountId: defaultAccount?.id,
      });
      setAmount("");
      await loadData();
      window.alert("Đã gửi yêu cầu rút tiền. Admin sẽ duyệt trong 1–2 ngày làm việc.");
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Không thể tạo yêu cầu rút tiền");
    } finally {
      setSaving(false);
    }
  };

  const saveBankAccount = async (payload) => {
    try {
      setSaving(true);
      await createBankAccount(payload);
      setBankModal(false);
      await loadData();
      window.alert("Đã lưu tài khoản ngân hàng.");
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Không thể lưu tài khoản");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (withdrawalId) => {
    if (!window.confirm("Hủy yêu cầu rút tiền này?")) {
      return;
    }
    try {
      await cancelWithdrawal(withdrawalId);
      await loadData();
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Không thể hủy yêu cầu");
    }
  };

  return (
    <>
      <RevenuePageActions>
        <button type="button" className="owner-management-secondary" onClick={loadData}>
          <RefreshCw size={17} />
          Làm mới
        </button>
        <button type="button" className="owner-management-secondary" onClick={() => setBankModal(true)}>
          <Info size={17} />
          Thêm tài khoản
        </button>
        <ExportReportButton rows={exportRows} filename="yeu-cau-rut-tien-owner.csv" />
      </RevenuePageActions>

      {error ? <p className="owner-empty-cell">{error}</p> : null}
      <RevenueStatGrid items={statItems} />

      <div className="owner-revenue-payment-layout owner-revenue-withdraw-layout">
        <section className="owner-management-panel owner-revenue-main-panel">
          <RevenueTableTabs tabs={TABLE_TABS} activeTab={activeTab} onChange={(value) => { setActiveTab(value); setPage(1); }} />
          <div className="owner-filterbar owner-revenue-filterbar">
            <RevenueDateRange dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
            <input
              className="owner-management-select"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Tìm kiếm mã yêu cầu..."
            />
          </div>

          <div className="owner-table-shell">
            <table className="owner-table owner-designed-table">
              <thead>
                <tr>
                  <th>Mã yêu cầu</th>
                  <th>Ngày tạo</th>
                  <th>Số tiền rút</th>
                  <th>Phí giao dịch</th>
                  <th>Số tiền nhận</th>
                  <th>Tài khoản nhận</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật cuối</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={9} className="owner-empty-cell">Đang tải yêu cầu rút tiền...</td></tr> : null}
                {!loading && visibleRows.length === 0 ? (
                  <tr><td colSpan={9} className="owner-empty-cell">Chưa có yêu cầu rút tiền trong bộ lọc.</td></tr>
                ) : null}
                {visibleRows.map((row) => {
                  const statusMeta = STATUS_LABELS[row.status] || { label: row.status, tone: "info" };
                  return (
                    <tr key={row.id}>
                      <td>{row.requestCode}</td>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>{formatCurrency(row.amount)}</td>
                      <td>{formatCurrency(row.fee)}</td>
                      <td>{formatCurrency(row.netAmount)}</td>
                      <td>{row.bankAccountLabel || "—"}</td>
                      <td>
                        <span className={`owner-revenue-type-badge owner-revenue-type-badge--${statusMeta.tone}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>{formatDateTime(row.updatedAt)}</td>
                      <td>
                        {row.status === "processing" ? (
                          <button type="button" className="owner-icon-mini" onClick={() => handleCancel(row.id)} aria-label="Hủy yêu cầu">
                            <X size={16} />
                          </button>
                        ) : (
                          <button type="button" className="owner-icon-mini" aria-label="Tùy chọn">
                            <MoreVertical size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <RevenuePagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            label="yêu cầu"
          />
        </section>

        <aside className="owner-revenue-side-stack" id="owner-quick-withdraw">
          <section className="owner-revenue-side-card">
            <div className="owner-revenue-side-head">
              <h3>Tài khoản nhận tiền</h3>
              <button type="button" className="owner-revenue-link-button" onClick={() => setBankModal(true)}>Quản lý tài khoản</button>
            </div>
            {defaultAccount ? (
              <div className="owner-revenue-bank-card">
                <strong>{defaultAccount.bankName}</strong>
                <span>{defaultAccount.accountNumber}</span>
                <small>{defaultAccount.accountHolderName}</small>
                {defaultAccount.isDefault ? <em>Mặc định</em> : null}
              </div>
            ) : (
              <p className="owner-empty-cell">Chưa có tài khoản ngân hàng.</p>
            )}
            <button type="button" className="owner-management-secondary owner-revenue-add-bank" onClick={() => setBankModal(true)}>
              <Plus size={16} />
              Thêm tài khoản ngân hàng
            </button>
          </section>

          <section className="owner-revenue-side-card owner-revenue-quick-withdraw">
            <h3>Rút tiền nhanh</h3>
            <p>Số dư khả dụng</p>
            <strong>{formatCurrency(balance.availableBalance)}</strong>
            <label>
              <span>Nhập số tiền muốn rút</span>
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Ví dụ: 5000000"
              />
            </label>
            <small>Phí giao dịch: {formatCurrency(WITHDRAWAL_FEE)} · Nhận: {formatCurrency(receivedAmount)}</small>
            <button type="button" className="owner-management-primary" onClick={submitWithdrawal} disabled={saving || !defaultAccount}>
              Rút tiền ngay
            </button>
          </section>

          <section className="owner-revenue-side-card">
            <h3>Lưu ý</h3>
            <ul className="owner-revenue-notes">
              <li>Yêu cầu rút tiền cần được admin duyệt trước khi chuyển khoản.</li>
              <li>Thời gian xử lý 1–2 ngày làm việc sau khi được duyệt.</li>
              <li>Số tiền tối thiểu {formatCurrency(balance.minWithdrawalAmount || 50000)}.</li>
            </ul>
            <Link to="/owner/settings" className="owner-revenue-inline-link-button">
              Xem thêm hướng dẫn <ArrowRight size={14} />
            </Link>
          </section>
        </aside>
      </div>

      <BankAccountModal
        open={bankModal}
        saving={saving}
        onClose={() => setBankModal(false)}
        onSubmit={saveBankAccount}
      />
    </>
  );
}
