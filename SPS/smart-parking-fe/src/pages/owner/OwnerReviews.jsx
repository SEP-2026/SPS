import { useEffect, useMemo, useState } from "react";
import { formatDateTime, SectionCard } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import API from "../../services/api";

const EMPTY_SUMMARY = {
  avg_rating: 0,
  total_reviews: 0,
  rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  unreplied_count: 0,
};

function buildReplyMap(list) {
  return Object.fromEntries((list || []).map((item) => [item.id, item.ownerReply || ""]));
}

export default function OwnerReviews() {
  const { ownerData, actions } = useOwnerContext();
  const [reviews, setReviews] = useState(ownerData.reviews);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [replyingId, setReplyingId] = useState("");
  const [replies, setReplies] = useState(() => buildReplyMap(ownerData.reviews));
  const [savingId, setSavingId] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [sortMode, setSortMode] = useState("newest");
  const [filterMode, setFilterMode] = useState("all");

  useEffect(() => {
    const fetchReviews = async () => {
      try {
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
        setReviews(ownerData.reviews);
        setReplies(buildReplyMap(ownerData.reviews));
      }
    };
    fetchReviews();
  }, [ownerData.reviews]);

  const openReplyBox = (review) => {
    setSaveNote("");
    setReplyingId(review.id);
    setReplies((prev) => ({ ...prev, [review.id]: prev[review.id] ?? review.ownerReply ?? "" }));
  };

  const cancelReply = () => {
    setReplyingId("");
    setSaveNote("");
  };

  const handleSaveReply = async (review) => {
    const nextReply = (replies[review.id] || "").trim();
    if (!nextReply || savingId) {
      return;
    }

    setSavingId(review.id);
    setSaveNote("");
    const hadReply = Boolean(review.ownerReply);
    const ok = await actions.updateReviewReply(review.id, nextReply);
    if (ok) {
      setReplyingId("");
      setReviews((prev) => prev.map((item) => (
        item.id === review.id ? { ...item, ownerReply: nextReply } : item
      )));
      setSummary((prev) => ({
        ...prev,
        unreplied_count: Math.max(0, Number(prev.unreplied_count || 0) - (hadReply ? 0 : 1)),
      }));
      setSaveNote("Đã lưu phản hồi đánh giá.");
    }
    setSavingId("");
  };

  const filteredReviews = useMemo(() => {
    let list = [...reviews];
    if (filterMode === "unreplied") {
      list = list.filter((item) => !item.ownerReply);
    }
    if (sortMode === "highest") {
      list.sort((a, b) => b.rating - a.rating);
    } else if (sortMode === "lowest") {
      list.sort((a, b) => a.rating - b.rating);
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [reviews, sortMode, filterMode]);

  return (
    <div className="owner-page-grid">
      <SectionCard title="Đánh giá & phản hồi khách hàng" subtitle="Theo dõi điểm số, phân loại đánh giá và phản hồi trực tiếp trên cùng một màn hình.">
        <div className="owner-review-summary-grid">
          <article className="owner-review-card owner-review-card--summary">
            <span className="owner-review-kicker">Điểm trung bình</span>
            <h3>{Number(summary.avg_rating || 0).toFixed(1)}<small>/5</small></h3>
            <p>{summary.total_reviews} đánh giá</p>
            <p>{summary.unreplied_count} đánh giá chưa phản hồi</p>
          </article>
          <article className="owner-review-card owner-review-card--distribution">
            <span className="owner-review-kicker">Phân bố sao</span>
            {[5, 4, 3, 2, 1].map((star) => (
              <div className="owner-rating-row" key={star}>
                <span>{star}★</span>
                <div className="owner-rating-track">
                  <span
                    style={{
                      width: `${((summary.rating_distribution?.[String(star)] || 0) / Math.max(summary.total_reviews || 0, 1)) * 100}%`,
                    }}
                  />
                </div>
                <strong>{summary.rating_distribution?.[String(star)] || 0}</strong>
              </div>
            ))}
          </article>
        </div>
        {saveNote ? <p className="owner-save-note">{saveNote}</p> : null}
        <div className="owner-review-filters">
          <button type="button" className={`owner-filter-btn ${sortMode === "newest" ? "active" : ""}`} onClick={() => setSortMode("newest")}>Mới nhất</button>
          <button type="button" className={`owner-filter-btn ${sortMode === "highest" ? "active" : ""}`} onClick={() => setSortMode("highest")}>Điểm cao</button>
          <button type="button" className={`owner-filter-btn ${sortMode === "lowest" ? "active" : ""}`} onClick={() => setSortMode("lowest")}>Điểm thấp</button>
          <button type="button" className={`owner-filter-btn ${filterMode === "all" ? "active" : ""}`} onClick={() => setFilterMode("all")}>Tất cả</button>
          <button type="button" className={`owner-filter-btn ${filterMode === "unreplied" ? "active" : ""}`} onClick={() => setFilterMode("unreplied")}>Chưa phản hồi</button>
        </div>
        <div className="owner-reviews">
          {filteredReviews.length === 0 ? (
            <p className="owner-empty">Không có đánh giá nào khớp bộ lọc hiện tại.</p>
          ) : null}
          {filteredReviews.map((review) => (
            <article key={review.id} className="owner-review-card">
              <div className="owner-review-head">
                <div>
                  <strong>{review.user}</strong>
                  <span>{formatDateTime(review.createdAt)}</span>
                </div>
                <div className="owner-review-rating">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
              </div>
              <p className="owner-review-content"><strong>{review.parkingLotName}</strong></p>
              <p className="owner-review-content">{review.content}</p>
              {review.ownerReply ? (
                <div className="owner-review-reply-box">
                  <span>Phản hồi của bạn</span>
                  <p>{review.ownerReply}</p>
                </div>
              ) : null}
              {replyingId === review.id ? (
                <label className="owner-review-reply">
                  {review.ownerReply ? "Cập nhật phản hồi" : "Phản hồi của bãi"}
                  <textarea
                    className="owner-input owner-textarea"
                    rows="3"
                    maxLength={300}
                    value={replies[review.id] || ""}
                    onChange={(event) => {
                      setReplies((prev) => ({ ...prev, [review.id]: event.target.value }));
                    }}
                    placeholder="Nhập phản hồi rõ ràng, lịch sự cho khách hàng"
                  />
                </label>
              ) : null}
              <div className="owner-review-actions">
                {replyingId === review.id ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary owner-btn owner-btn--small"
                      disabled={savingId === review.id || !(replies[review.id] || "").trim()}
                      onClick={() => handleSaveReply(review)}
                    >
                      {savingId === review.id ? "Đang lưu..." : "Lưu phản hồi"}
                    </button>
                    <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={cancelReply}>
                      Hủy
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-primary owner-btn owner-btn--small" onClick={() => openReplyBox(review)}>
                    {review.ownerReply ? "Sửa phản hồi" : "Phản hồi đánh giá"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
