import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import API from "../services/api";
import "./ReviewForm.css";

const STAR_LABELS = {
  1: "Rất tệ",
  2: "Tệ",
  3: "Bình thường",
  4: "Tốt",
  5: "Xuất sắc",
};

export default function ReviewForm({ bookingId, parkingName, onSubmit, onSkip }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const activeRating = hoverRating || rating;
  const label = useMemo(() => STAR_LABELS[activeRating] || "Chọn số sao phù hợp", [activeRating]);

  const submitReview = async () => {
    if (!rating) {
      setError("Vui lòng chọn số sao trước khi gửi đánh giá.");
      return;
    }
    try {
      setSubmitting(true);
      setError("");
      const res = await API.post("/reviews", {
        booking_id: bookingId,
        rating,
        comment: comment.trim() || null,
      });
      onSubmit?.(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Không gửi được đánh giá, vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="review-form">
      <h3>⭐ Đánh giá bãi đỗ xe</h3>
      <p className="review-form-parking">{parkingName || "Bãi đỗ"}</p>

      <p className="review-form-label">Chất lượng dịch vụ:</p>
      <div className="review-stars" onMouseLeave={() => setHoverRating(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`review-star ${activeRating >= star ? "active" : ""}`}
            onMouseEnter={() => setHoverRating(star)}
            onClick={() => setRating(star)}
          >
            <Star size={20} fill={activeRating >= star ? "#eab308" : "none"} />
          </button>
        ))}
      </div>
      <p className="review-form-hint">{label}</p>

      <label className="review-form-label" htmlFor={`review-comment-${bookingId}`}>Nhận xét (tùy chọn):</label>
      <textarea
        id={`review-comment-${bookingId}`}
        className="review-form-textarea"
        placeholder="Viết nhận xét của bạn..."
        maxLength={500}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <p className="review-form-count">{comment.length}/500 ký tự</p>

      {error ? <p className="review-form-error">{error}</p> : null}

      <div className="review-form-actions">
        <button type="button" className="review-btn secondary" onClick={onSkip} disabled={submitting}>Bỏ qua</button>
        <button type="button" className="review-btn primary" onClick={submitReview} disabled={submitting}>
          {submitting ? "Đang gửi..." : "Gửi đánh giá ⭐"}
        </button>
      </div>
    </section>
  );
}
