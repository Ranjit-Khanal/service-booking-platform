export function RatingStars({ rating, reviewCount }: { rating: number; reviewCount?: number }) {
  const full = Math.round(rating);
  return (
    <span className="rating" aria-label={`Rated ${rating} out of 5`}>
      <span className="rating__stars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < full ? 'rating__star rating__star--full' : 'rating__star'}>
            ★
          </span>
        ))}
      </span>
      <span className="rating__value">{rating.toFixed(1)}</span>
      {reviewCount != null && <span className="muted rating__count">({reviewCount} reviews)</span>}
    </span>
  );
}
