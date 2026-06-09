import { useEffect, useMemo, useState } from "react";
import API, { getAuth } from "../services/api";
import { buildDynamicVietQrUrl } from "../features/gate/gateFormatters";
import { formatCurrency } from "../features/gate/gateFormatters";
import { formatDateTimeVN } from "../utils/dateTime";
import { useWallet } from "../context/WalletContext";
import "./Profile.css";
import "./Wallet.css";
import "./PaymentHistory.css";

/* Currency formatter */
const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const formatMoney = (value) => currency.format(Number(value || 0));

/* Utility functions */
const formatCurrencyString = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("vi-VN");
};

const parseCurrencyString = (value) => String(value || "").replace(/\D/g, "");

const PAGE_SIZE = 6;

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "paid", label: "Đã thanh toán" },
  { value: "pending", label: "Chờ thanh toán" },
  { value: "overdue", label: "Quá hạn check-in" },
  { value: "cancelled", label: "Đã hủy" },
  { value: "completed", label: "Hoàn tất" },
];

const STATUS_LABELS = {
  pending: "Chờ thanh toán",
  paid: "Đã thanh toán",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
  failed: "Thất bại",
  refunded: "Đã hoàn tiền",
  booked: "Đã đặt",
  checked_in: "Đang gửi xe",
  checked_out: "Đã check-out",
};

const translateStatus = (status) => {
  if (!status) return "N/A";
  const key = String(status).toLowerCase();
  return STATUS_LABELS[key] || status;
};

const getRowStatusMeta = (row) => {
  const rawPaymentStatus = String(row?.payment_status || "").toLowerCase();
  const rawBookingStatus = String(row?.booking_status || "").toLowerCase();

  if (rawBookingStatus === "cancelled" && row?.cancel_reason === "no_show") {
    return { key: "overdue", label: "Quá hạn check-in", tone: "danger" };
  }

  if (rawPaymentStatus === "paid" || rawPaymentStatus === "completed") {
    return { key: "paid", label: "Đã thanh toán", tone: "success" };
  }

  if (rawPaymentStatus === "pending") {
    return { key: "pending", label: "Chờ thanh toán", tone: "warning" };
  }

  if (rawBookingStatus === "cancelled" || rawPaymentStatus === "failed") {
    return { key: "cancelled", label: rawPaymentStatus === "failed" ? "Thất bại" : "Đã hủy", tone: "danger" };
  }

  if (rawPaymentStatus === "refunded") {
    return { key: "refunded", label: "Đã hoàn tiền", tone: "neutral" };
  }

  if (rawBookingStatus === "checked_out" || rawPaymentStatus === "completed") {
    return { key: "completed", label: "Hoàn tất", tone: "success" };
  }

  return {
    key: rawPaymentStatus || rawBookingStatus || "unknown",
    label: translateStatus(rawPaymentStatus || rawBookingStatus),
    tone: "neutral",
  };
};

/* Icons */
const IconWallet = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.5 7.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-14a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M17 11h3v4h-3a2 2 0 0 1 0-4z" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="17.8" cy="13" r="0.85" fill="currentColor" />
  </svg>
);

const IconReceipt = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 3h10v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V3z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const IconWarning = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 4 3 20h18L12 4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M12 9v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="12" cy="17" r="0.9" fill="currentColor" />
  </svg>
);

export default function Wallet() {
  const auth = getAuth();
  const { wallet, loading: walletQueryLoading, error: walletQueryError, refreshWallet } = useWallet();

  /* Wallet top-up state */
  const [walletTopUpAmount, setWalletTopUpAmount] = useState("");
  const [walletPendingAmount, setWalletPendingAmount] = useState(null);
  const [walletTopUpQrUrl, setWalletTopUpQrUrl] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletNotice, setWalletNotice] = useState("");
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [pmLoading, setPmLoading] = useState(true);
  const [pmError, setPmError] = useState("");

  /* Payment history state */
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  /* Fetch payment history */
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const res = await API.get("/payment/history");
        setRows(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setError(err?.response?.data?.detail || "Không tải được lịch sử thanh toán");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  /* Fetch payment methods */
  useEffect(() => {
    const loadPM = async () => {
      try {
        setPmLoading(true);
        setPmError("");
        const res = await API.get("/wallet/methods");
        const data = res.data;
        const methods = Array.isArray(data) ? data : Array.isArray(data?.methods) ? data.methods : [];
        setPaymentMethods(methods);
      } catch (err) {
        setPmError(err?.response?.data?.detail || "Không tải được phương thức thanh toán");
        setPaymentMethods([]);
      } finally {
        setPmLoading(false);
      }
    };

    loadPM();
  }, []);

  /* Payment history summary */
  const summary = useMemo(() => {
    const totalPaid = rows.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
    const totalBooking = rows.reduce((sum, item) => sum + Number(item.booking_amount || 0), 0);
    const totalDeposit = rows.reduce((sum, item) => sum + Number(item.deposit_amount || 0), 0);
    return { totalPaid, totalBooking, totalDeposit };
  }, [rows]);

  /* Filter and paginate payment history */
  const filteredRows = useMemo(() => {
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;

    return rows.filter((row) => {
      const meta = getRowStatusMeta(row);
      if (statusFilter !== "all" && meta.key !== statusFilter) {
        return false;
      }

      if (!fromDate && !toDate) {
        return true;
      }

      const createdAt = row.booking_created_at ? new Date(row.booking_created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) {
        return false;
      }

      if (fromDate && createdAt < fromDate) {
        return false;
      }

      if (toDate && createdAt > toDate) {
        return false;
      }

      return true;
    });
  }, [rows, statusFilter, dateFrom, dateTo]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const pagedRows = useMemo(() => {
    const startIndex = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredRows, page]);

  const hasActiveFilters = Boolean(statusFilter !== "all" || dateFrom || dateTo);

  const clearFilters = () => {
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  /* Wallet top-up handlers */
  const handleTopUpWallet = async (event) => {
    event.preventDefault();
    setWalletNotice("");

    const amount = Number(walletTopUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWalletNotice("Số tiền nạp phải lớn hơn 0");
      return;
    }

    setWalletPendingAmount(amount);
    setWalletTopUpQrUrl("");
  };

  const confirmTopUpWallet = async () => {
    if (!Number.isFinite(walletPendingAmount) || walletPendingAmount <= 0) {
      setWalletNotice("Số tiền nạp phải lớn hơn 0");
      setWalletPendingAmount(null);
      setWalletTopUpQrUrl("");
      return;
    }

    const qrUrl = buildDynamicVietQrUrl(walletPendingAmount, `WALLET-${auth?.user?.id || "USER"}`);
    if (!qrUrl) {
      setWalletNotice("Không thể tạo QR chuyển khoản");
      return;
    }

    setWalletTopUpQrUrl(qrUrl);
    setWalletNotice("Quét QR và chuyển đúng số tiền, sau đó bấm xác nhận để cộng vào ví");
  };

  const completeTopUpWallet = async () => {
    if (!Number.isFinite(walletPendingAmount) || walletPendingAmount <= 0) {
      setWalletNotice("Số tiền nạp phải lớn hơn 0");
      setWalletPendingAmount(null);
      setWalletTopUpQrUrl("");
      return;
    }

    try {
      setWalletLoading(true);
      await API.post("/wallet/topup", {
        amount: walletPendingAmount,
        note: "Nạp ví qua QR chuyển khoản",
      });
      await refreshWallet();
      setWalletTopUpAmount("");
      setWalletPendingAmount(null);
      setWalletTopUpQrUrl("");
      setWalletNotice("Nạp tiền thành công");
    } catch (err) {
      setWalletNotice(err?.response?.data?.detail || "Nạp tiền thất bại");
    } finally {
      setWalletLoading(false);
    }
  };

  const cancelTopUpWallet = () => {
    setWalletPendingAmount(null);
    setWalletTopUpQrUrl("");
  };

  /* Pagination renderer */
  const renderPagination = () => {
    if (filteredRows.length <= PAGE_SIZE) {
      return null;
    }

    const visiblePages = [];
    const startPage = Math.max(1, page - 1);
    const endPage = Math.min(pageCount, page + 1);

    for (let index = startPage; index <= endPage; index += 1) {
      visiblePages.push(index);
    }

    return (
      <div className="payment-history-pagination" aria-label="Phân trang lịch sử thanh toán">
        <button type="button" className="payment-page-btn" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
          Trước
        </button>

        {startPage > 1 ? (
          <>
            <button type="button" className={`payment-page-btn${page === 1 ? " is-active" : ""}`} onClick={() => setPage(1)}>
              1
            </button>
            {startPage > 2 ? <span className="payment-page-ellipsis">…</span> : null}
          </>
        ) : null}

        {visiblePages.map((item) => (
          <button
            key={item}
            type="button"
            className={`payment-page-btn${page === item ? " is-active" : ""}`}
            onClick={() => setPage(item)}
          >
            {item}
          </button>
        ))}

        {endPage < pageCount ? (
          <>
            {endPage < pageCount - 1 ? <span className="payment-page-ellipsis">…</span> : null}
            <button type="button" className={`payment-page-btn${page === pageCount ? " is-active" : ""}`} onClick={() => setPage(pageCount)}>
              {pageCount}
            </button>
          </>
        ) : null}

        <button type="button" className="payment-page-btn" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>
          Sau
        </button>
      </div>
    );
  };

  return (
    <section className="page-wrap">
      <div className="page-card profile-shell profile-frame wallet-shell">
        <form className="profile-card wallet-page" onSubmit={handleTopUpWallet}>
          {/* ========== PART 1: WALLET SECTION ========== */}
          <header className="wallet-header">
            <nav className="wallet-breadcrumb">Trang chủ › <span>Ví của tôi</span></nav>
            <div className="wallet-title-row">
              <h1 className="wallet-title">Ví của tôi</h1>
              <p className="wallet-subtitle">Quản lý số dư và lịch sử giao dịch của bạn</p>
            </div>
          </header>

          <div className="wallet-hero">
            <div className="wallet-balance">
              <span className="wallet-label">Số dư hiện tại</span>
              {walletQueryLoading ? (
                <strong className="wallet-amount">Đang tải...</strong>
              ) : walletQueryError ? (
                <strong className="wallet-amount">Không tải được</strong>
              ) : (
                <strong className="wallet-amount">{formatCurrency(wallet?.balance || 0)}</strong>
              )}

              <div className="wallet-substats">
                <div>
                  <small>Số dư khả dụng</small>
                  <div className="wallet-subval">{walletQueryLoading ? "..." : walletQueryError ? "-" : formatCurrency(wallet?.balance || 0)}</div>
                </div>
                <div>
                  <small>Số dư đóng băng</small>
                  <div className="wallet-subval">{walletQueryLoading ? "..." : walletQueryError ? "-" : formatCurrency(wallet?.reserved_balance || 0)}</div>
                </div>
              </div>
            </div>

            <div className="wallet-illustration" aria-hidden="true">👛</div>

            <div className="wallet-cta">
              <button type="button" className="profile-action-btn wallet-topup-cta" onClick={() => document.querySelector('.profile-topup-input')?.focus()}>
                ＋ Nạp tiền vào ví
              </button>
            </div>
          </div>

          <section className="wallet-quick-topup">
            <div className="profile-topup-presets">
              {[200000, 500000, 1000000, 2000000, 5000000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`profile-topup-preset ${String(walletTopUpAmount) === String(amount) ? 'is-active' : ''}`}
                  onClick={() => { setWalletTopUpAmount(String(amount)); setWalletPendingAmount(null); setWalletTopUpQrUrl(""); }}
                >
                  {amount.toLocaleString('vi-VN')} đ
                </button>
              ))}
              <button type="button" className={`profile-topup-preset ${walletTopUpAmount === 'other' ? 'is-active' : ''}`} onClick={() => setWalletTopUpAmount('')}>Khác</button>
            </div>

            <div className="profile-input-shell">
              <span className="profile-input-icon" aria-hidden="true">➕</span>
              <input
                className="booking-input profile-input profile-topup-input"
                type="text"
                inputMode="numeric"
                placeholder="Ví dụ: 100.000"
                value={walletTopUpAmount ? formatCurrencyString(walletTopUpAmount) : ""}
                onChange={(e) => { setWalletTopUpAmount(parseCurrencyString(e.target.value)); if (walletPendingAmount !== null) setWalletPendingAmount(null); if (walletTopUpQrUrl) setWalletTopUpQrUrl(""); }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="profile-action-btn" type="submit" disabled={walletLoading || walletQueryLoading}>{walletLoading ? 'Đang xử lý...' : '→ Nạp tiền'}</button>
            </div>
          </section>

          <div className="wallet-bottom-sections" style={{ marginTop: 16 }}>
            <div className="wallet-bottom-left">
              <h4>Phương thức thanh toán đã liên kết</h4>
              {pmLoading ? (
                <p>Đang tải...</p>
              ) : pmError ? (
                <p className="wallet-bottom-error">{pmError}</p>
              ) : paymentMethods.length === 0 ? (
                <p>Chưa có phương thức thanh toán liên kết.</p>
              ) : (
                <ul className="wallet-methods-list">
                  {paymentMethods.map((m) => (
                    <li key={m.id || m.key || JSON.stringify(m)}>
                      <strong>{m.name || m.brand || m.type || 'Phương thức'}</strong>
                      <div className="wallet-method-sub">{m.details || m.mask || m.info || ''}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="wallet-bottom-right">
              <h4>Chính sách & lưu ý</h4>
              <ul className="wallet-policies-list">
                <li>Vui lòng chỉ nạp tiền từ tài khoản chính chủ.</li>
                <li>Số tiền nạp sẽ được cập nhật sau khi quản trị xác nhận giao dịch.</li>
                <li>Mọi tranh chấp vui lòng liên hệ hỗ trợ 24/7.</li>
              </ul>
            </div>
          </div>

          {walletPendingAmount !== null ? (
            <div className="profile-topup-confirm">
              {!walletTopUpQrUrl ? (
                <>
                  <p>Xác nhận tạo QR chuyển khoản {walletPendingAmount.toLocaleString('vi-VN')} đ để nạp ví?</p>
                  <div className="profile-topup-confirm-actions">
                    <button type="button" className="profile-action-btn profile-action-confirm" onClick={confirmTopUpWallet} disabled={walletLoading || walletQueryLoading}>Tạo QR chuyển khoản</button>
                    <button type="button" className="profile-action-btn profile-action-cancel" onClick={cancelTopUpWallet} disabled={walletLoading || walletQueryLoading}>Hủy</button>
                  </div>
                </>
              ) : (
                <>
                  <p>Quét QR để chuyển đúng số tiền: {walletPendingAmount.toLocaleString('vi-VN')} đ</p>
                  <div className="profile-topup-qr-box"><img src={walletTopUpQrUrl} alt="QR topup wallet" /></div>
                  <div className="profile-topup-confirm-actions">
                    <button type="button" className="profile-action-btn profile-action-confirm" onClick={completeTopUpWallet} disabled={walletLoading || walletQueryLoading}>{walletLoading ? 'Đang xử lý...' : 'Tôi đã chuyển khoản thành công'}</button>
                    <button type="button" className="profile-action-btn profile-action-cancel" onClick={cancelTopUpWallet} disabled={walletLoading || walletQueryLoading}>Hủy</button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {walletNotice ? <p className={`profile-notice ${walletNotice.toLowerCase().includes('thành công') ? 'success' : 'error'}`} aria-live="polite">{walletNotice}</p> : null}

          {/* ========== SECTION DIVIDER ========== */}
          <hr style={{ margin: '2rem 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

          {/* ========== PART 2: PAYMENT HISTORY SECTION ========== */}
          <div className="payment-history-section">
            <header className="payment-history-section-header">
              <div className="payment-history-hero-copy">
                <p className="payment-history-kicker">Lịch sử giao dịch</p>
                <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#1e4764' }}>Lịch sử thanh toán</h2>
              </div>

              <div className="payment-history-filters" aria-label="Bộ lọc lịch sử thanh toán">
                <label className="payment-filter-field">
                  <span>Trạng thái</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    {STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="payment-filter-field">
                  <span>Từ ngày</span>
                  <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                </label>

                <label className="payment-filter-field">
                  <span>Đến ngày</span>
                  <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                </label>

                <button type="button" className="payment-filter-reset" onClick={clearFilters} disabled={!hasActiveFilters}>
                  Xóa lọc
                </button>
              </div>
            </header>

            <div className="payment-summary-grid">
              <article className="payment-summary-card payment-summary-card--accent">
                <div className="payment-summary-icon payment-summary-icon--success"><IconWallet /></div>
                <span>Đã thanh toán</span>
                <strong>{formatMoney(summary.totalPaid)}</strong>
                <small>Tổng số tiền đã chốt từ các booking.</small>
              </article>

              <article className="payment-summary-card">
                <div className="payment-summary-icon"><IconReceipt /></div>
                <span>Tổng tiền booking</span>
                <strong>{formatMoney(summary.totalBooking)}</strong>
                <small>Giá trị booking trước khi trừ cọc / hoàn tiền.</small>
              </article>

              <article className="payment-summary-card payment-summary-card--warning">
                <div className="payment-summary-icon payment-summary-icon--warning"><IconWarning /></div>
                <span>Tổng tiền cọc no-show</span>
                <strong>{formatMoney(summary.totalDeposit)}</strong>
                <small>Khoản cọc xử lý cho các booking quá hạn check-in.</small>
              </article>
            </div>

            {loading ? <p className="payment-history-state payment-history-state--loading">Đang tải dữ liệu...</p> : null}
            {error ? <p className="payment-history-state payment-history-state--error">{error}</p> : null}

            {!loading && !error ? (
              <div className="payment-history-table-card">
                <div className="payment-history-table-topbar">
                  <div>
                    <h2>Danh sách giao dịch</h2>
                    <p>
                      {filteredRows.length} giao dịch{filteredRows.length !== rows.length ? ` trên ${rows.length} bản ghi` : ""}
                    </p>
                  </div>
                  <div className="payment-history-table-hint">Các số tiền được canh phải để dễ so sánh.</div>
                </div>

                <div className="payment-history-table-wrap">
                  <table className="payment-history-table">
                    <thead>
                      <tr>
                        <th>Booking</th>
                        <th>Trạng thái</th>
                        <th className="is-number">Tiền booking</th>
                        <th className="is-number">Đã thanh toán</th>
                        <th className="is-number">Tiền cọc 30%</th>
                        <th>Ngày tạo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="payment-history-empty">Không có dữ liệu phù hợp với bộ lọc hiện tại.</td>
                        </tr>
                      ) : (
                        pagedRows.map((row) => {
                          const statusMeta = getRowStatusMeta(row);
                          return (
                            <tr key={row.booking_id}>
                              <td>
                                <div className="payment-booking-cell">
                                  <span className="payment-booking-badge">#{row.booking_id}</span>
                                  <span className="payment-booking-subline">Booking #{row.booking_id}</span>
                                </div>
                              </td>
                              <td>
                                <span className={`payment-status-pill payment-status-pill--${statusMeta.tone}`}>
                                  {statusMeta.label}
                                </span>
                              </td>
                              <td className="is-number">{formatMoney(row.booking_amount)}</td>
                              <td className="is-number">{formatMoney(row.paid_amount)}</td>
                              <td className="is-number">{formatMoney(row.deposit_amount)}</td>
                              <td>{formatDateTimeVN(row.booking_created_at, "N/A")}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {renderPagination()}
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}

