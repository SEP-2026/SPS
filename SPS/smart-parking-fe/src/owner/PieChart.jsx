export function PieChart({ data, formatValue = (v) => v, hideLegend = false, className = "" }) {
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  const colors = {
    active: "#10b981",
    pending: "#f59e0b",
    locked: "#ef4444",
    suspended: "#8b5cf6",
    banned: "#ef4444",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
  };

  let currentAngle = -90;
  const slices = data.map((item) => {
    const sliceAngle = (item.amount / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const radius = 80;

    const x1 = 100 + radius * Math.cos(startRad);
    const y1 = 100 + radius * Math.sin(startRad);
    const x2 = 100 + radius * Math.cos(endRad);
    const y2 = 100 + radius * Math.sin(endRad);

    const largeArc = sliceAngle > 180 ? 1 : 0;
    const pathData = [
      `M 100 100`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `Z`,
    ].join(" ");

    return {
      ...item,
      pathData,
      color: item.color || colors[item.label.toLowerCase()] || colors[item.status] || "#6366f1",
      percentage: ((item.amount / total) * 100).toFixed(1),
    };
  });

  const shellClassName = [
    "owner-pie-shell",
    hideLegend ? "owner-pie-shell--chart-only" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClassName}>
      <svg viewBox="0 0 200 200" className="owner-pie-chart" role="img" aria-label="Biểu đồ tỷ lệ">
        {slices.map((slice, idx) => (
          <path key={idx} d={slice.pathData} fill={slice.color} stroke="white" strokeWidth="2" />
        ))}
        <circle cx="100" cy="100" r="50" fill="white" />
        <text x="100" y="100" textAnchor="middle" dominantBaseline="middle" className="owner-pie-center-text">
          {formatValue(total)}
        </text>
      </svg>

      {!hideLegend ? (
        <div className="owner-pie-legend">
          {slices.map((slice, idx) => (
            <div key={idx} className="owner-pie-item">
              <span className="owner-pie-color" style={{ backgroundColor: slice.color }} />
              <span className="owner-pie-label">
                {slice.label} ({slice.percentage}%)
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
