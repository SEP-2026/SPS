import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDateTime, SectionCard } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import API from "../../services/api";

export default function OwnerReviews() {
  const { ownerData } = useOwnerContext();
  const [reviews, setReviews] = useState(ownerData.reviews);
  const [summary, setSummary] = useState({ avg_rating: 0, total_reviews: 0, rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, unreplied_count: 0 });
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
      } catch {
        setReviews(ownerData.reviews);
      }
    };
    fetchReviews();
  }, [ownerData.reviews]);

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
      <SectionCard title="Đánh giá bãi đỗ xe" subtitle="Theo dõi điểm số và phản hồi đánh giá của khách hàng.">
        <div className="owner-two-col">
          <article className="owner-review-card">
            <h3>⭐ {Number(summary.avg_rating || 0).toFixed(1)}/5</h3>
            <p>{summary.total_reviews} đánh giá</p>
            <p>{summary.unreplied_count} đánh giá chưa phản hồi</p>
          </article>
          <article className="owner-review-card">
            {[5, 4, 3, 2, 1].map((star) => (
              <p key={star}>
                {star}★: {summary.rating_distribution?.[String(star)] || 0}
              </p>
            ))}
          </article>
        </div>
        <div className="payment-success-actions" style={{ marginBottom: 12 }}>
          <Link to="/owner/review-replies" className="btn-primary owner-btn">
            Phản hồi đánh giá
          </Link>
        </div>
        <div className="owner-review-filters">
          <button type="button" className={`owner-filter-btn ${sortMode === "newest" ? "active" : ""}`} onClick={() => setSortMode("newest")}>Mới nhất</button>
          <button type="button" className={`owner-filter-btn ${sortMode === "highest" ? "active" : ""}`} onClick={() => setSortMode("highest")}>Điểm cao</button>
          <button type="button" className={`owner-filter-btn ${sortMode === "lowest" ? "active" : ""}`} onClick={() => setSortMode("lowest")}>Điểm thấp</button>
          <button type="button" className={`owner-filter-btn ${filterMode === "all" ? "active" : ""}`} onClick={() => setFilterMode("all")}>Tất cả</button>
          <button type="button" className={`owner-filter-btn ${filterMode === "unreplied" ? "active" : ""}`} onClick={() => setFilterMode("unreplied")}>Chưa phản hồi</button>
        </div>
        <div className="owner-reviews">
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
                <p className="owner-review-content"><strong>💬 Phản hồi của bạn:</strong> {review.ownerReply}</p>
              ) : null}
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
