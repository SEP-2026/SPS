import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  Filter,
  Frown,
  MessageSquare,
  MoreVertical,
  Search,
  Smile,
  Star,
  ThumbsUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import API from "../../services/api";
import { formatDateTime } from "../../owner/OwnerUI";
import { downloadCsv, formatNumber, getInitials } from "../../owner/ownerUtils";
import { useOwnerContext } from "../../owner/useOwnerContext";

const EMPTY_SUMMARY = {
  avg_rating: 0,
  total_reviews: 0,
  rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  unreplied_count: 0,
};

const REVIEW_TABS = [
  { value: "all", label: "Mới nhất" },
  { value: "five", label: "Đánh giá 5 sao" },
  { value: "low", label: "Đánh giá thấp (1-2 sao)" },
  { value: "unreplied", label: "Chưa phản hồi" },
];

function buildReplyMap(list) {
  return Object.fromEntries((list || []).map((item) => [item.id, item.ownerReply || ""]));
}

function toDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function toDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--/--";
  }
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(date);
}

function StarRating({ rating }) {
  return (
    <span className="owner-star-rating" aria-label={`${rating} sao`}>
      {"★".repeat(Number(rating || 0))}{"☆".repeat(Math.max(0, 5 - Number(rating || 0)))}
    </span>
  );
}

function ReviewTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <div className="owner-chart-tooltip">
      <strong>{label}</strong>
      <span>{payload[0].value} đánh giá</span>
    </div>
  );
}

export default function OwnerReviews() {
  const { ownerData, actions } = useOwnerContext();
  const [reviews, setReviews] = useState(ownerData.reviews || []);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [parkingFilter, setParkingFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [replyingId, setReplyingId] = useState("");
  const [replies, setReplies] = useState(() => buildReplyMap(ownerData.reviews));
  const [savingId, setSavingId] = useState("");
  const [selectedReview, setSelectedReview] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setLoading(true);
        const res = await API.get("/owner/reviews");
        const nextReviews = res.data?.reviews || [];
        setReviews(nextReviews);
        setSummary({
          avg_rating: res.data?.avg_rating || 0,
          total_reviews: res.data?.total_reviews || 0,
          rating_distribution: res.data?.rating_distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          unreplied_count: res.data?.unreplied_count || 0,
        });
        setReplies(buildReplyMap(nextReviews));
      } catch {
        setReviews(ownerData.reviews || []);
        setReplies(buildReplyMap(ownerData.reviews || []));
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, [ownerData.reviews]);

  const parkingOptions = useMemo(() => (
    Array.from(new Set(reviews.map((review) => review.parkingLotName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"))
  ), [reviews]);

  const trendData = useMemo(() => {
    const buckets = new Map();
    const now = new Date();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - index);
      buckets.set(toDateKey(date), { label: toDateLabel(date), total: 0 });
    }
    reviews.forEach((review) => {
      const key = toDateKey(review.createdAt);
      if (buckets.has(key)) {
        buckets.get(key).total += 1;
      }
    });
    return Array.from(buckets.values());
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let list = reviews.filter((review) => {
      if (parkingFilter !== "all" && review.parkingLotName !== parkingFilter) {
        return false;
      }
      if (ratingFilter !== "all" && Number(review.rating) !== Number(ratingFilter)) {
        return false;
      }
      if (activeTab === "five" && Number(review.rating) !== 5) {
        return false;
      }
      if (activeTab === "low" && Number(review.rating) > 2) {
        return false;
      }
      if (activeTab === "unreplied" && review.ownerReply) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [review.user, review.parkingLotName, review.content, review.ownerReply].join(" ").toLowerCase().includes(keyword);
    });
    list = [...list].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    return list;
  }, [activeTab, parkingFilter, ratingFilter, reviews, search]);

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(filteredReviews.length / pageSize));
  const visibleReviews = filteredReviews.slice((page - 1) * pageSize, page * pageSize);
  const fiveStarCount = Number(summary.rating_distribution?.["5"] || summary.rating_distribution?.[5] || 0);
  const fourStarCount = Number(summary.rating_distribution?.["4"] || summary.rating_distribution?.[4] || 0);
  const lowStarCount = Number(summary.rating_distribution?.["1"] || summary.rating_distribution?.[1] || 0)
    + Number(summary.rating_distribution?.["2"] || summary.rating_distribution?.[2] || 0);
  const satisfaction = summary.total_reviews ? Math.round(((fiveStarCount + fourStarCount) / summary.total_reviews) * 100) : 0;

  const handleSaveReply = async (review) => {
    const reply = (replies[review.id] || "").trim();
    if (!reply || savingId) {
      return;
    }
    setSavingId(review.id);
    const ok = await actions.updateReviewReply(review.id, reply);
    if (ok) {
      setReviews((current) => current.map((item) => (
        item.id === review.id ? { ...item, ownerReply: reply } : item
      )));
      setSummary((current) => ({
        ...current,
        unreplied_count: Math.max(0, Number(current.unreplied_count || 0) - (review.ownerReply ? 0 : 1)),
      }));
      setReplyingId("");
    }
    setSavingId("");
  };

  const exportReviews = () => {
    downloadCsv("danh-gia-phan-hoi-owner.csv", filteredReviews.map((review) => ({
      khach_hang: review.user,
      bai_xe: review.parkingLotName,
      so_sao: review.rating,
      noi_dung: review.content,
      phan_hoi: review.ownerReply || "",
      thoi_gian: formatDateTime(review.createdAt),
    })));
  };

  return (
    <div className="owner-designed-page owner-reviews-page">
      <div className="owner-page-actions">
        <button type="button" className="owner-management-secondary" onClick={exportReviews}>
          <Download size={17} />
          Xuất báo cáo
        </button>
      </div>

      <div className="owner-management-stats owner-designed-stats">
        <article className="owner-management-stat owner-management-stat--blue">
          <span><Star size={23} /></span>
          <div><p>Điểm đánh giá trung bình</p><strong>{Number(summary.avg_rating || 0).toFixed(1)} / 5</strong><small>{formatNumber(summary.total_reviews)} đánh giá</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--sky">
          <span><MessageSquare size={23} /></span>
          <div><p>Tổng số đánh giá</p><strong>{formatNumber(summary.total_reviews)}</strong><small>{formatNumber(summary.unreplied_count)} chưa phản hồi</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--green">
          <span><Smile size={23} /></span>
          <div><p>Đánh giá 5 sao</p><strong>{formatNumber(fiveStarCount)}</strong><small>{summary.total_reviews ? Math.round((fiveStarCount / summary.total_reviews) * 100) : 0}% tổng đánh giá</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--orange">
          <span><ThumbsUp size={23} /></span>
          <div><p>Đánh giá 4 sao</p><strong>{formatNumber(fourStarCount)}</strong><small>Cần duy trì chất lượng</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--pink">
          <span><Frown size={23} /></span>
          <div><p>Đánh giá 1-2 sao</p><strong>{formatNumber(lowStarCount)}</strong><small>Cần xử lý ưu tiên</small></div>
        </article>
      </div>

      <div className="owner-filterbar owner-review-filterbar">
        <label className="owner-management-search">
          <Search size={18} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm kiếm nội dung, khách hàng, bãi xe..." />
        </label>
        <select className="owner-management-select" value={parkingFilter} onChange={(event) => { setParkingFilter(event.target.value); setPage(1); }}>
          <option value="all">Tất cả bãi xe</option>
          {parkingOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="owner-management-select" value={ratingFilter} onChange={(event) => { setRatingFilter(event.target.value); setPage(1); }}>
          <option value="all">Tất cả mức đánh giá</option>
          {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} sao</option>)}
        </select>
        <button type="button" className="owner-management-secondary" onClick={() => setPage(1)}>
          <Filter size={17} />
          Bộ lọc
        </button>
      </div>

      <div className="owner-review-analytics-grid">
        <section className="owner-management-panel">
          <div className="owner-panel-heading">
            <div><h3>Xu hướng đánh giá</h3><p>7 ngày gần nhất</p></div>
          </div>
          <div className="owner-chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="reviewTrend" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#6d28d9" stopOpacity={0.26} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ReviewTooltip />} />
                <Area type="monotone" dataKey="total" stroke="#6d28d9" strokeWidth={3} fill="url(#reviewTrend)" />
                <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: "#ffffff", stroke: "#6d28d9" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="owner-management-panel owner-rating-distribution">
          <div className="owner-panel-heading">
            <div><h3>Phân bố đánh giá</h3><p>Theo số sao</p></div>
          </div>
          {[5, 4, 3, 2, 1].map((rating) => {
            const count = Number(summary.rating_distribution?.[String(rating)] || summary.rating_distribution?.[rating] || 0);
            const percent = summary.total_reviews ? Math.round((count / summary.total_reviews) * 100) : 0;
            return (
              <div className="owner-rating-line" key={rating}>
                <span>{rating} sao</span>
                <div><i style={{ width: `${percent}%` }} /></div>
                <strong>{percent}% ({count})</strong>
              </div>
            );
          })}
        </section>

        <section className="owner-management-panel owner-satisfaction-card">
          <div className="owner-gauge" style={{ "--score": `${satisfaction}%` }}>
            <strong>{satisfaction}%</strong>
            <span>Rất hài lòng</span>
          </div>
          <p>{formatNumber(fiveStarCount + fourStarCount)} đánh giá tích cực</p>
        </section>
      </div>

      <section className="owner-management-panel">
        <div className="owner-customer-tabs owner-review-tabs">
          {REVIEW_TABS.map((tab) => (
            <button key={tab.value} type="button" className={activeTab === tab.value ? "is-active" : ""} onClick={() => { setActiveTab(tab.value); setPage(1); }}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="owner-review-list-v2">
          {loading ? <p className="owner-empty-cell">Đang tải đánh giá...</p> : null}
          {!loading && visibleReviews.length === 0 ? <p className="owner-empty-cell">Không có đánh giá nào khớp bộ lọc.</p> : null}
          {visibleReviews.map((review) => (
            <article key={review.id} className="owner-review-row-v2">
              <div className="owner-customer-avatar">{getInitials(review.user)}</div>
              <div className="owner-review-person">
                <strong>{review.user}</strong>
                <span>Đặt chỗ: BK-{review.bookingId}</span>
              </div>
              <div className="owner-review-score">
                <StarRating rating={review.rating} />
                <span>{formatDateTime(review.createdAt)}</span>
              </div>
              <div className="owner-review-copy">
                <p>{review.content || "Khách hàng không để lại nội dung."}</p>
                <span>{review.parkingLotName}</span>
                {review.ownerReply ? <em>Đã phản hồi: {review.ownerReply}</em> : null}
                {replyingId === review.id ? (
                  <textarea
                    className="owner-input owner-textarea"
                    rows="3"
                    maxLength={300}
                    value={replies[review.id] || ""}
                    onChange={(event) => setReplies((current) => ({ ...current, [review.id]: event.target.value }))}
                    placeholder="Nhập phản hồi cho khách hàng"
                  />
                ) : null}
              </div>
              <div className="owner-review-actions-v2">
                {replyingId === review.id ? (
                  <>
                    <button type="button" className="owner-management-primary" disabled={savingId === review.id || !(replies[review.id] || "").trim()} onClick={() => handleSaveReply(review)}>
                      {savingId === review.id ? "Đang lưu..." : "Lưu"}
                    </button>
                    <button type="button" className="owner-management-secondary" onClick={() => setReplyingId("")}>Hủy</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="owner-management-secondary" onClick={() => { setReplyingId(review.id); setReplies((current) => ({ ...current, [review.id]: current[review.id] ?? review.ownerReply ?? "" })); }}>
                      {review.ownerReply ? "Sửa phản hồi" : "Phản hồi"}
                    </button>
                    <button type="button" className="owner-icon-mini" onClick={() => setSelectedReview(review)} aria-label="Xem chi tiết"><Eye size={16} /></button>
                    <button type="button" className="owner-icon-mini" onClick={() => setSelectedReview(review)} aria-label="Mở thêm"><MoreVertical size={16} /></button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="owner-management-pagination">
          <span>Hiển thị {filteredReviews.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, filteredReviews.length)} trong tổng số {formatNumber(filteredReviews.length)} đánh giá</span>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
            <button type="button" className={page === 1 ? "is-active" : ""} onClick={() => setPage(1)}>1</button>
            {totalPages > 1 ? <button type="button" className={page === 2 ? "is-active" : ""} onClick={() => setPage(2)}>2</button> : null}
            {totalPages > 2 ? <span>...</span> : null}
            {totalPages > 2 ? <button type="button" className={page === totalPages ? "is-active" : ""} onClick={() => setPage(totalPages)}>{totalPages}</button> : null}
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>›</button>
          </div>
        </div>
      </section>

      {selectedReview ? (
        <div className="owner-modal-backdrop" onClick={() => setSelectedReview(null)}>
          <div className="owner-modal owner-modal--detail" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>Chi tiết đánh giá</h2>
                <p>{selectedReview.parkingLotName}</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={() => setSelectedReview(null)}>×</button>
            </div>
            <div className="owner-detail-grid">
              <div><span>Khách hàng</span><strong>{selectedReview.user}</strong></div>
              <div><span>Mã đặt chỗ</span><strong>BK-{selectedReview.bookingId}</strong></div>
              <div><span>Điểm</span><strong>{selectedReview.rating}/5</strong></div>
              <div><span>Thời gian</span><strong>{formatDateTime(selectedReview.createdAt)}</strong></div>
            </div>
            <p className="owner-modal-note">{selectedReview.content || "Không có nội dung."}</p>
            {selectedReview.ownerReply ? <p className="owner-modal-note">Phản hồi: {selectedReview.ownerReply}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
