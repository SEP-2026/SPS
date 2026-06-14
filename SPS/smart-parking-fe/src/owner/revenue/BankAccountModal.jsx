import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, CheckCircle2, Loader2, Search, Sparkles, X } from "lucide-react";
import { fetchVietQrBanks, lookupVietQrAccount } from "../../services/vietqrApi";

const EMPTY_FORM = {
  bankCode: "",
  bankName: "",
  bankBin: "",
  bankLogo: "",
  lookupSupported: true,
  accountNumber: "",
  accountHolderName: "",
  isDefault: true,
};

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export default function BankAccountModal({ open, saving, onClose, onSubmit }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [banks, setBanks] = useState([]);
  const [banksTotal, setBanksTotal] = useState(0);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [lookupState, setLookupState] = useState("idle");
  const [lookupMessage, setLookupMessage] = useState("");
  const lookupTimerRef = useRef(null);
  const lookupRequestRef = useRef(0);
  const pickerRef = useRef(null);

  const loadBanks = useCallback(async () => {
    setBanksLoading(true);
    setBanksError("");
    try {
      const { banks: items, total } = await fetchVietQrBanks();
      setBanks(items);
      setBanksTotal(total || items.length);
      const defaultBank = items.find((item) => item.code === "VCB") || items[0];
      if (defaultBank) {
        setForm((prev) => ({
          ...prev,
          bankCode: defaultBank.code,
          bankName: defaultBank.shortName || defaultBank.name,
          bankBin: defaultBank.bin,
          bankLogo: defaultBank.logo,
          lookupSupported: Boolean(defaultBank.lookupSupported),
        }));
        setBankQuery(defaultBank.shortName || defaultBank.name);
      }
    } catch (error) {
      setBanksError(error?.response?.data?.detail || "Không tải được danh sách ngân hàng");
    } finally {
      setBanksLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setBankPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setForm(EMPTY_FORM);
    setBankQuery("");
    setLookupState("idle");
    setLookupMessage("");
    setBankPickerOpen(false);
    loadBanks();
    return () => {
      if (lookupTimerRef.current) {
        clearTimeout(lookupTimerRef.current);
      }
    };
  }, [open, loadBanks]);

  const filteredBanks = useMemo(() => {
    const keyword = bankQuery.trim().toLowerCase();
    if (!keyword) {
      return banks;
    }
    return banks.filter((bank) => {
      const haystack = [bank.shortName, bank.name, bank.code, bank.bin].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [bankQuery, banks]);

  const runLookup = useCallback(async (bankBin, accountNumber, lookupSupported) => {
    const normalizedAccount = normalizeDigits(accountNumber);
    if (!bankBin || normalizedAccount.length < 6) {
      setLookupState("idle");
      setLookupMessage("");
      return;
    }
    if (!lookupSupported) {
      setLookupState("manual");
      setLookupMessage("Ngân hàng này chưa hỗ trợ tra cứu tự động. Vui lòng nhập tên chủ tài khoản.");
      return;
    }

    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    setLookupState("loading");
    setLookupMessage("Đang tra cứu chủ tài khoản...");

    try {
      const result = await lookupVietQrAccount({
        bankBin,
        accountNumber: normalizedAccount,
      });
      if (lookupRequestRef.current !== requestId) {
        return;
      }
      setForm((prev) => ({
        ...prev,
        accountHolderName: result.accountName || prev.accountHolderName,
      }));
      setLookupState("found");
      setLookupMessage("Đã xác minh chủ tài khoản.");
    } catch (error) {
      if (lookupRequestRef.current !== requestId) {
        return;
      }
      const detail = error?.response?.data?.detail || "";
      const missingApiKey = typeof detail === "string" && detail.includes("API Key");
      setLookupState("manual");
      setLookupMessage(
        missingApiKey
          ? "Tra cứu tự động chưa bật trên máy chủ. Vui lòng nhập tên chủ tài khoản (IN HOA)."
          : (detail || "Không tra cứu được. Vui lòng nhập tên chủ tài khoản thủ công."),
      );
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    if (lookupTimerRef.current) {
      clearTimeout(lookupTimerRef.current);
    }
    lookupTimerRef.current = setTimeout(() => {
      runLookup(form.bankBin, form.accountNumber, form.lookupSupported);
    }, 650);
    return () => {
      if (lookupTimerRef.current) {
        clearTimeout(lookupTimerRef.current);
      }
    };
  }, [form.accountNumber, form.bankBin, form.lookupSupported, open, runLookup]);

  const selectBank = (bank) => {
    setForm((prev) => ({
      ...prev,
      bankCode: bank.code,
      bankName: bank.shortName || bank.name,
      bankBin: bank.bin,
      bankLogo: bank.logo,
      lookupSupported: Boolean(bank.lookupSupported),
      accountHolderName: "",
    }));
    setBankQuery(bank.shortName || bank.name);
    setBankPickerOpen(false);
    setLookupState("idle");
    setLookupMessage("");
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.bankCode || !form.bankBin) {
      window.alert("Vui lòng chọn ngân hàng từ danh sách gợi ý.");
      return;
    }
    onSubmit({
      bankCode: form.bankCode,
      bankName: form.bankName,
      accountNumber: normalizeDigits(form.accountNumber),
      accountHolderName: form.accountHolderName.trim(),
      isDefault: form.isDefault,
    });
  };

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="owner-bank-modal-backdrop" onClick={() => !saving && onClose()}>
      <form
        className="owner-bank-modal"
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="owner-bank-modal__glow" aria-hidden="true" />
        <header className="owner-bank-modal__header">
          <div className="owner-bank-modal__title-wrap">
            <span className="owner-bank-modal__badge">
              <Sparkles size={14} />
              Liên kết ngân hàng
            </span>
            <h2>Thêm tài khoản nhận tiền</h2>
            <p>Chọn ngân hàng, nhập số tài khoản — hệ thống tự điền tên chủ tài khoản.</p>
          </div>
          <button type="button" className="owner-bank-modal__close" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        {form.bankLogo ? (
          <div className="owner-bank-modal__selected-bank">
            <img src={form.bankLogo} alt="" />
            <div>
              <strong>{form.bankName}</strong>
              <span>{form.bankCode} · BIN {form.bankBin}</span>
            </div>
          </div>
        ) : null}

        <div className="owner-bank-modal__grid">
          <label className="owner-bank-field owner-bank-field--full">
            <span>
              Ngân hàng
              {banksTotal ? <small className="owner-bank-field__meta"> · {banksTotal} ngân hàng từ VietQR</small> : null}
            </span>
            <div ref={pickerRef} className={`owner-bank-picker${bankPickerOpen ? " is-open" : ""}`}>
              <Search size={16} />
              <input
                value={bankQuery}
                onChange={(event) => {
                  setBankQuery(event.target.value);
                  setBankPickerOpen(true);
                }}
                onFocus={() => setBankPickerOpen(true)}
                placeholder={banksLoading ? "Đang tải danh sách ngân hàng..." : "Tìm Vietcombank, MB, ACB..."}
                autoComplete="off"
              />
              {bankPickerOpen ? (
                <div className="owner-bank-picker__dropdown">
                  {!banksError && filteredBanks.length > 0 ? (
                    <p className="owner-bank-picker__summary">
                      {bankQuery.trim()
                        ? `${filteredBanks.length} kết quả`
                        : `Tất cả ${filteredBanks.length} ngân hàng — cuộn để xem thêm`}
                    </p>
                  ) : null}
                  {banksError ? <p className="owner-bank-picker__empty">{banksError}</p> : null}
                  {!banksError && filteredBanks.length === 0 ? (
                    <p className="owner-bank-picker__empty">Không tìm thấy ngân hàng phù hợp.</p>
                  ) : null}
                  {filteredBanks.map((bank) => (
                    <button
                      key={bank.id || bank.code}
                      type="button"
                      className={`owner-bank-picker__option${form.bankCode === bank.code ? " is-active" : ""}`}
                      onClick={() => selectBank(bank)}
                    >
                      {bank.logo ? <img src={bank.logo} alt="" /> : <Building2 size={18} />}
                      <span>
                        <strong>{bank.shortName || bank.name}</strong>
                        <small>{bank.code} · {bank.bin}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>

          <label className="owner-bank-field">
            <span>Số tài khoản</span>
            <input
              inputMode="numeric"
              value={form.accountNumber}
              onChange={(event) => setForm((prev) => ({
                ...prev,
                accountNumber: normalizeDigits(event.target.value),
                accountHolderName: "",
              }))}
              placeholder="Nhập số tài khoản"
              required
            />
          </label>

          <label className="owner-bank-field">
            <span>Chủ tài khoản</span>
            <div className={`owner-bank-holder${lookupState === "found" ? " is-verified" : ""}`}>
              <input
                value={form.accountHolderName}
                onChange={(event) => {
                  setLookupState("manual");
                  setForm((prev) => ({ ...prev, accountHolderName: event.target.value.toUpperCase() }));
                }}
                placeholder={
                  lookupState === "manual"
                    ? "Nhập tên chủ tài khoản (IN HOA)"
                    : "Tự động sau khi tra cứu"
                }
                required
              />
              {lookupState === "loading" ? <Loader2 size={18} className="owner-bank-spin" /> : null}
              {lookupState === "found" ? <CheckCircle2 size={18} className="owner-bank-verified-icon" /> : null}
            </div>
          </label>
        </div>

        {lookupMessage ? (
          <p className={`owner-bank-lookup-note owner-bank-lookup-note--${lookupState}`}>
            {lookupMessage}
          </p>
        ) : null}

        <label className="owner-bank-default">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(event) => setForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
          />
          Đặt làm tài khoản mặc định khi rút tiền
        </label>

        <div className="owner-bank-modal__actions">
          <button type="button" className="owner-management-secondary" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button
            type="submit"
            className="owner-management-primary owner-bank-modal__submit"
            disabled={saving || !form.bankCode || !form.accountNumber || !form.accountHolderName}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="owner-bank-spin" />
                Đang lưu...
              </>
            ) : "Lưu tài khoản"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
