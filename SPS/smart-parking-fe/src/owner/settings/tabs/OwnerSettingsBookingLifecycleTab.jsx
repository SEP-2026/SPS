import { useEffect, useState } from "react";
import { BOOKING_LIFECYCLE_SECTIONS } from "../ownerSettingsConstants";
import { BOOKING_LIFECYCLE_DEFAULTS } from "../bookingLifecycleDefaults";
import {
  SettingsField,
  SettingsPanel,
  SettingsSaveButton,
  SettingsSplitLayout,
  SettingsSubNav,
  SettingsToggle,
} from "../OwnerSettingsShared";
import { fetchOwnerBookingConfig, saveOwnerBookingConfig } from "../../../services/ownerBookingConfigApi";

function NumberUnitRow({ label, value, onValue, unit, unitOptions, onUnit, min = 0 }) {
  return (
    <SettingsField label={label}>
      <div className="owner-settings-number-unit">
        <input
          className="owner-input"
          type="number"
          min={min}
          value={value}
          onChange={(e) => onValue(Number(e.target.value))}
        />
        {unitOptions ? (
          <select className="owner-input owner-select" value={unit} onChange={(e) => onUnit(e.target.value)}>
            {unitOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        ) : (
          <span className="owner-settings-unit-label">{unit}</span>
        )}
      </div>
    </SettingsField>
  );
}

function RadioGroup({ name, value, onChange, options }) {
  return (
    <div className="owner-settings-radio-group" role="radiogroup" aria-label={name}>
      {options.map((opt) => (
        <label key={opt.value} className="owner-settings-radio">
          <input type="radio" name={name} checked={value === opt.value} onChange={() => onChange(opt.value)} />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

const TIME_UNITS = [
  { value: "minutes", label: "phút" },
  { value: "hours", label: "giờ" },
];

export default function OwnerSettingsBookingLifecycleTab() {
  const [section, setSection] = useState("booking-rules");
  const [form, setForm] = useState(BOOKING_LIFECYCLE_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const config = await fetchOwnerBookingConfig();
        setForm(config);
      } catch (error) {
        setLoadError(error?.response?.data?.detail || "Không tải được cấu hình từ máy chủ.");
        setForm(BOOKING_LIFECYCLE_DEFAULTS);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const patch = (key, value) => {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const patchTemplate = (key, value) => {
    setSaved(false);
    setForm((prev) => ({
      ...prev,
      templates: { ...prev.templates, [key]: value },
    }));
  };

  const handleSave = async (event) => {
    event?.preventDefault?.();
    setSaving(true);
    setSaved(false);
    try {
      const savedConfig = await saveOwnerBookingConfig(form);
      setForm(savedConfig);
      setSaved(true);
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không lưu được cấu hình.");
    } finally {
      setSaving(false);
    }
  };

  const renderSection = () => {
    switch (section) {
      case "booking-rules":
        return (
          <SettingsPanel title="Quy tắc đặt chỗ" subtitle="Đặt chỗ → thanh toán cọc → giữ chỗ.">
            <div className="owner-settings-lifecycle-grid owner-settings-lifecycle-grid--1">
              <SettingsToggle checked={form.allowPrebook} onChange={() => patch("allowPrebook", !form.allowPrebook)} label="Cho phép đặt chỗ trước" />
              <NumberUnitRow
                label="Thời gian được đặt trước tối đa"
                value={form.maxPrebookDays}
                onValue={(v) => patch("maxPrebookDays", v)}
                unit="ngày"
              />
              <NumberUnitRow
                label="Thời gian giữ chỗ sau khi tạo booking"
                value={form.holdMinutes}
                onValue={(v) => patch("holdMinutes", v)}
                unit="phút"
              />
              <NumberUnitRow
                label="Số chỗ tối đa trong 1 lượt đặt"
                value={form.maxSlotsPerBooking}
                onValue={(v) => patch("maxSlotsPerBooking", v)}
                unit="chỗ"
              />
              <SettingsToggle
                checked={form.requireDeposit}
                onChange={() => patch("requireDeposit", !form.requireDeposit)}
                label="Yêu cầu thanh toán cọc trước khi xác nhận booking"
              />
              <NumberUnitRow
                label="Tiền cọc bắt buộc"
                value={form.depositPercent}
                onValue={(v) => patch("depositPercent", v)}
                unit="% tổng tiền"
              />
            </div>
          </SettingsPanel>
        );

      case "cancel-change":
        return (
          <SettingsPanel title="Quy định huỷ / đổi đặt chỗ" subtitle="Huỷ, hoàn tiền về ví và đổi thời gian.">
            <div className="owner-settings-lifecycle-grid">
              <SettingsToggle checked={form.allowCancel} onChange={() => patch("allowCancel", !form.allowCancel)} label="Cho phép huỷ đặt chỗ" />
              <NumberUnitRow
                label="Thời hạn huỷ miễn phí"
                value={form.freeCancelValue}
                onValue={(v) => patch("freeCancelValue", v)}
                unit={form.freeCancelUnit}
                unitOptions={TIME_UNITS}
                onUnit={(u) => patch("freeCancelUnit", u)}
              />
              <NumberUnitRow
                label="Nếu huỷ đúng hạn: hoàn về ví"
                value={form.refundOnTimePercent}
                onValue={(v) => patch("refundOnTimePercent", v)}
                unit="%"
              />
              <SettingsToggle checked={form.forfeitDepositLate} onChange={() => patch("forfeitDepositLate", !form.forfeitDepositLate)} label="Nếu huỷ quá hạn: mất cọc" />
              <SettingsToggle checked={form.allowCancelOverlap} onChange={() => patch("allowCancelOverlap", !form.allowCancelOverlap)} label="Cho phép huỷ booking cũ khi có booking trùng" />
              {form.allowCancelOverlap ? (
                <>
                  <SettingsToggle checked={form.overlapOnlyBeforeCheckin} onChange={() => patch("overlapOnlyBeforeCheckin", !form.overlapOnlyBeforeCheckin)} label="Chỉ huỷ booking cũ khi chưa check-in" />
                  <NumberUnitRow label="Hoàn tiền cọc booking cũ" value={form.overlapRefundPercent} onValue={(v) => patch("overlapRefundPercent", v)} unit="%" />
                </>
              ) : null}
              <NumberUnitRow label="Thời gian hoàn tiền về ví" value={form.refundToWalletHours} onValue={(v) => patch("refundToWalletHours", v)} unit="giờ" />
              <SettingsToggle checked={form.allowReschedule} onChange={() => patch("allowReschedule", !form.allowReschedule)} label="Cho phép đổi thời gian đặt" />
              <NumberUnitRow label="Giới hạn số lần đổi thời gian" value={form.maxRescheduleTimes} onValue={(v) => patch("maxRescheduleTimes", v)} unit="lần" />
              <NumberUnitRow
                label="Thời hạn đổi trước giờ bắt đầu"
                value={form.rescheduleBeforeValue}
                onValue={(v) => patch("rescheduleBeforeValue", v)}
                unit={form.rescheduleBeforeUnit}
                unitOptions={TIME_UNITS}
                onUnit={(u) => patch("rescheduleBeforeUnit", u)}
              />
            </div>
          </SettingsPanel>
        );

      case "checkin":
        return (
          <SettingsPanel title="Cấu hình check-in" subtitle="Thời gian sớm/trễ và nhắc khách.">
            <div className="owner-settings-lifecycle-grid owner-settings-lifecycle-grid--1">
              <NumberUnitRow label="Check-in sớm miễn phí trong" value={form.earlyCheckinFreeMinutes} onValue={(v) => patch("earlyCheckinFreeMinutes", v)} unit="phút" />
              <NumberUnitRow label="Nếu check-in sớm hơn: tính thêm" value={form.earlyCheckinChargeHours} onValue={(v) => patch("earlyCheckinChargeHours", v)} unit="giờ" />
              <NumberUnitRow label="Check-in trễ tối đa" value={form.maxLateCheckinMinutes} onValue={(v) => patch("maxLateCheckinMinutes", v)} unit="phút" />
              <SettingsField label="Nếu quá thời gian check-in trễ">
                <RadioGroup
                  name="lateCheckinAction"
                  value={form.lateCheckinAction}
                  onChange={(v) => patch("lateCheckinAction", v)}
                  options={[
                    { value: "auto_cancel", label: "Tự động huỷ booking" },
                    { value: "deny", label: "Không cho check-in" },
                    { value: "both", label: "Cả hai" },
                  ]}
                />
              </SettingsField>
              <NumberUnitRow label="Nhắc khách trước giờ check-in" value={form.remindBeforeCheckinMinutes} onValue={(v) => patch("remindBeforeCheckinMinutes", v)} unit="phút" />
            </div>
          </SettingsPanel>
        );

      case "checkout":
        return (
          <SettingsPanel title="Cấu hình check-out" subtitle="Trễ giờ, phí phát sinh và QR sau checkout.">
            <div className="owner-settings-lifecycle-grid owner-settings-lifecycle-grid--1">
              <SettingsToggle checked={form.allowLateCheckout} onChange={() => patch("allowLateCheckout", !form.allowLateCheckout)} label="Cho phép check-out trễ" />
              <NumberUnitRow label="Thời gian trễ miễn phí" value={form.lateCheckoutFreeMinutes} onValue={(v) => patch("lateCheckoutFreeMinutes", v)} unit="phút" />
              <NumberUnitRow label="Nếu check-out trễ: tính thêm mỗi" value={form.lateCheckoutChargePerHours} onValue={(v) => patch("lateCheckoutChargePerHours", v)} unit="giờ" />
              <NumberUnitRow label="Nếu trễ quá: tính theo giá ngày sau" value={form.lateCheckoutDayThresholdHours} onValue={(v) => patch("lateCheckoutDayThresholdHours", v)} unit="giờ" />
              <div className="owner-settings-info-box owner-settings-info-box--blue">
                Sau check-out: booking theo giờ → QR hết hiệu lực; booking theo ngày/tháng → QR theo giới hạn gói.
              </div>
            </div>
          </SettingsPanel>
        );

      case "qr-rules":
        return (
          <SettingsPanel title="Quy tắc QR ra/vào bãi" subtitle="Một mã QR cho check-in và check-out.">
            <ul className="owner-settings-checkin-rules">
              <li><SettingsToggle checked={form.qrShared} onChange={() => patch("qrShared", !form.qrShared)} label="Một mã QR dùng chung check-in / check-out" /></li>
              <li><SettingsToggle checked={form.qrValidInBookingWindow} onChange={() => patch("qrValidInBookingWindow", !form.qrValidInBookingWindow)} label="QR chỉ hiệu lực trong thời gian booking" /></li>
              <li><SettingsToggle checked={form.qrNoReuse} onChange={() => patch("qrNoReuse", !form.qrNoReuse)} label="QR không dùng lại sau khi hết hiệu lực" /></li>
              <li><SettingsToggle checked={form.qrEncryptedPerBooking} onChange={() => patch("qrEncryptedPerBooking", !form.qrEncryptedPerBooking)} label="QR mã hoá theo từng booking" /></li>
            </ul>
            <div className="owner-settings-info-box owner-settings-info-box--blue" style={{ marginTop: 12 }}>
              QR hết hiệu lực khi: checkout thành công, booking huỷ, hết thời gian đặt, hết lượt ra/vào, hoặc hết hạn gói ngày/tháng.
            </div>
          </SettingsPanel>
        );

      case "entry-exit":
        return (
          <SettingsPanel title="Số lần ra/vào theo loại đặt" subtitle="Theo giờ / ngày / tháng.">
            <div className="owner-table-shell">
              <table className="owner-table owner-designed-table">
                <thead>
                  <tr>
                    <th>Loại đặt</th>
                    <th>Số lần ra/vào</th>
                    <th>Quy định</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Theo giờ</strong></td>
                    <td>1 lần</td>
                    <td>Checkout xong là kết thúc booking</td>
                  </tr>
                  <tr>
                    <td><strong>Theo ngày</strong></td>
                    <td>
                      <input
                        className="owner-input"
                        type="number"
                        min={1}
                        style={{ maxWidth: 80 }}
                        value={form.dailyMaxEntries}
                        onChange={(e) => patch("dailyMaxEntries", Number(e.target.value))}
                      />
                      {" "}lần/ngày
                    </td>
                    <td>Hoặc đến khi hết ngày</td>
                  </tr>
                  <tr>
                    <td><strong>Theo tháng</strong></td>
                    <td>Không giới hạn</td>
                    <td>Hết tháng thì QR hết hiệu lực</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <SettingsToggle
              checked={form.hourlySingleEntry}
              onChange={() => patch("hourlySingleEntry", !form.hourlySingleEntry)}
              label="Theo giờ: ra/vào 1 lần duy nhất"
            />
            <SettingsToggle
              checked={form.monthlyUnlimited}
              onChange={() => patch("monthlyUnlimited", !form.monthlyUnlimited)}
              label="Theo tháng: ra/vào không giới hạn"
            />
          </SettingsPanel>
        );

      case "booking-notify":
        return (
          <SettingsPanel title="Thông báo đặt chỗ" subtitle="Gửi cho khách trong vòng đời booking.">
            <div className="owner-settings-lifecycle-grid owner-settings-lifecycle-grid--2">
              <SettingsToggle checked={form.notifyBookingSuccess} onChange={() => patch("notifyBookingSuccess", !form.notifyBookingSuccess)} label="Gửi thông báo đặt chỗ thành công" />
              <SettingsToggle checked={form.notifyDepositSuccess} onChange={() => patch("notifyDepositSuccess", !form.notifyDepositSuccess)} label="Gửi thông báo thanh toán cọc thành công" />
              <SettingsToggle checked={form.notifyCheckinReminder} onChange={() => patch("notifyCheckinReminder", !form.notifyCheckinReminder)} label="Gửi nhắc nhở trước giờ check-in" />
              <SettingsToggle checked={form.notifyHoldExpiring} onChange={() => patch("notifyHoldExpiring", !form.notifyHoldExpiring)} label="Gửi cảnh báo sắp hết thời gian giữ chỗ" />
              <SettingsToggle checked={form.notifyBookingCancelled} onChange={() => patch("notifyBookingCancelled", !form.notifyBookingCancelled)} label="Gửi thông báo booking bị huỷ" />
              <SettingsToggle checked={form.notifyRefundWallet} onChange={() => patch("notifyRefundWallet", !form.notifyRefundWallet)} label="Gửi thông báo hoàn tiền về ví" />
            </div>
          </SettingsPanel>
        );

      case "templates":
        return (
          <SettingsPanel title="Mẫu nội dung thông báo" subtitle="Biến: {ten_khach}, {ma_dat_cho}, {ten_bai_xe}, {gio_vao}, {so_tien}, {phut}, {hoan_tien}.">
            <div className="owner-settings-templates-grid">
              {[
                ["bookingConfirm", "Xác nhận đặt chỗ"],
                ["depositSuccess", "Thanh toán cọc thành công"],
                ["checkinReminder", "Nhắc sắp đến giờ vào bãi"],
                ["cancelled", "Huỷ đặt chỗ"],
                ["refund", "Hoàn tiền"],
                ["checkoutSuccess", "Checkout thành công"],
                ["lateFee", "Phát sinh phí trễ giờ"],
              ].map(([key, title]) => (
                <label key={key} className="owner-settings-template-card">
                  <span>{title}</span>
                  <textarea
                    className="owner-input"
                    rows={4}
                    value={form.templates[key]}
                    onChange={(e) => patchTemplate(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </SettingsPanel>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return <p className="owner-empty">Đang tải cấu hình đặt chỗ & ra/vào...</p>;
  }

  return (
    <div className="owner-settings-booking-lifecycle">
      {loadError ? (
        <p className="owner-settings-load-error">{loadError}</p>
      ) : (
        <p className="owner-settings-sync-note">
          Cấu hình đã đồng bộ CSDL. Cọc, thời gian check-in trễ và huỷ no-show áp dụng cho booking, thanh toán và cổng ra/vào.
        </p>
      )}
      <SettingsSplitLayout
        subnav={(
          <div>
            <p className="owner-settings-subnav-intro">
              Cấu hình vòng đời: đặt chỗ → cọc → giữ chỗ → check-in → check-out → huỷ/hoàn tiền.
            </p>
            <SettingsSubNav items={BOOKING_LIFECYCLE_SECTIONS} activeId={section} onChange={setSection} />
          </div>
        )}
        children={(
          <form onSubmit={handleSave}>
            {renderSection()}
            <div className="owner-settings-lifecycle-footer">
              <SettingsSaveButton saving={saving} saved={saved} label="Lưu thay đổi" />
            </div>
          </form>
        )}
      />
    </div>
  );
}
