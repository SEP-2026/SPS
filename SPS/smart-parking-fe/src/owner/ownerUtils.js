export function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

export function getInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return "SP";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

export function downloadCsv(filename, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    window.alert("Không có dữ liệu để xuất.");
    return;
  }
  const headers = Object.keys(safeRows[0]);
  const escapeCell = (value) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [
    headers.map(escapeCell).join(","),
    ...safeRows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
  ].join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
