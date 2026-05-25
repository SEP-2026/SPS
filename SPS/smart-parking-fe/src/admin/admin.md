# Smart Parking - Admin Dashboard UI Specification

## 1. Tổng quan màn hình

Đây là màn hình Dashboard dành cho Super Admin của hệ thống Smart Parking.  
Mục tiêu của màn hình:

- Theo dõi toàn bộ hoạt động hệ thống
- Giám sát doanh thu nền tảng
- Theo dõi trạng thái bãi đỗ xe
- Quản lý người dùng / chủ bãi / thiết bị
- Hiển thị cảnh báo realtime
- Thống kê và phân tích dữ liệu

---

# 2. Layout Tổng Thể

## 2.1 Cấu trúc bố cục

Layout chia thành 2 phần chính:

### Sidebar trái (Fixed)

Chiều rộng:
- ~260px

Chức năng:
- Logo hệ thống
- Navigation menu
- Banner giới thiệu
- Logout button

Sidebar luôn cố định khi scroll.

---

### Main Content

Chiếm toàn bộ phần còn lại.

Bao gồm:

1. Header top bar
2. KPI cards
3. Charts & Analytics
4. Tables / Activities
5. Monitoring widgets
6. System status footer

---

# 3. Tone màu chủ đạo

## 3.1 Màu nền chính

### Background chính
```css
#F5F7FB
```

Màu xám trắng nhẹ giúp:
- sạch
- hiện đại
- dễ nhìn dashboard

---

## 3.2 Sidebar Gradient

```css
from: #021B3A
to:   #003B73
```

Tone:
- xanh navy
- công nghệ
- chuyên nghiệp
- futuristic

---

## 3.3 Accent Colors

### Blue (Primary)
```css
#1677FF
```

Dùng cho:
- button
- active menu
- chart
- icon chính

---

### Green (Success)
```css
#16C784
```

Dùng cho:
- trạng thái hoạt động tốt
- doanh thu tăng
- success badge

---

### Orange (Warning)
```css
#FF9F1A
```

Dùng cho:
- warning
- pending
- attention

---

### Red (Danger)
```css
#FF4D4F
```

Dùng cho:
- lỗi hệ thống
- mất kết nối
- cảnh báo nghiêm trọng

---

### Purple
```css
#7B61FF
```

Dùng cho:
- commission
- analytics
- premium section

---

# 4. Typography

## Font đề xuất

```txt
Inter
Poppins
SF Pro Display
```

---

## Font hierarchy

### Heading lớn
```css
font-size: 32px
font-weight: 700
```

### Card title
```css
font-size: 14px
font-weight: 500
```

### KPI number
```css
font-size: 30px
font-weight: 700
```

### Description
```css
font-size: 13px
color: #8C8C8C
```

---

# 5. Sidebar Specification

## 5.1 Logo Section

Bao gồm:
- Logo Smart Parking
- Subtitle: Admin Console

Style:
- dark transparent card
- blur nhẹ

---

## 5.2 Navigation Menu

Các menu:

- Tổng quan
- Chủ bãi / Đối tác
- Duyệt đăng ký
- Hoa hồng & thanh toán
- Người dùng
- Bãi đỗ xe
- Khu vực
- Thiết bị
- Cảnh báo hệ thống
- Phân tích
- Báo cáo
- Nhật ký hệ thống
- Cài đặt hệ thống

---

## 5.3 Active Menu Style

```css
background: linear-gradient(90deg, #00B2FF, #1677FF);
box-shadow: blue glow;
border-radius: 14px;
```

---

# 6. Header Top Bar

## Thành phần

### Greeting section
Ví dụ:
```txt
Xin chào, Admin One 👋
```

### Date Picker
- Hôm nay
- 7 ngày
- 30 ngày

### Notification Bell
- badge số lượng

### User Profile
- avatar
- role
- dropdown menu

---

# 7. KPI Cards

## Layout

Grid:
```txt
6 cards / row
```

Responsive:
- Desktop: 6
- Tablet: 3
- Mobile: 1

---

## KPI hiển thị

### Tổng chủ bãi
- icon users
- growth %

### Tổng bãi xe
- icon parking

### Tổng chỗ đỗ
- icon P

### Tổng booking
- icon calendar

### Doanh thu nền tảng
- icon money

### Hoa hồng thu được
- icon analytics

---

## Card Style

```css
background: white;
border-radius: 20px;
padding: 20px;
box-shadow: 0 4px 20px rgba(0,0,0,0.04);
```

Hover:
```css
transform: translateY(-3px);
```

---

# 8. Charts & Analytics

## 8.1 Revenue Line Chart

Hiển thị:
- doanh thu theo ngày
- filter thời gian

Màu:
```css
line-color: #1677FF
```

Có:
- tooltip
- smooth curve
- hover point

---

## 8.2 Parking Status Donut Chart

Hiển thị:
- hoạt động tốt
- đang hoạt động
- tạm dừng
- ngưng hoạt động

Màu:
- xanh lá
- xanh dương
- vàng
- đỏ

Center:
```txt
Tổng bãi xe
1,248
```

---

## 8.3 Daily Revenue Bar Chart

Bao gồm:
- doanh thu
- hoa hồng

Chart type:
- mixed bar + line

---

# 9. Activity Section

## 9.1 Hoạt động hệ thống

Hiển thị realtime activities:

Ví dụ:
- tạo bãi xe
- thanh toán
- cảnh báo camera
- đăng ký user
- trạng thái thiết bị

---

## 9.2 Row Structure

```txt
[time] [icon] [description] [tag]
```

Tag color:
- success
- warning
- info
- danger

---

# 10. System Alerts

## Alert Types

### Thiết bị mất kết nối
- màu đỏ

### Bãi đầy > 90%
- màu vàng

### Thanh toán thất bại
- màu cam

### Chưa xác thực hợp đồng
- màu xanh

---

## Alert Card Style

```css
border-left: 4px solid statusColor;
```

---

# 11. Online Users Widget

Hiển thị:

- Người dùng online
- Chủ bãi online
- Nhân viên online

Mỗi item:
- icon
- total count
- tăng hôm nay

---

# 12. Top Revenue Owners

Danh sách top chủ bãi:

Hiển thị:
- avatar
- tên
- khu vực
- doanh thu

---

# 13. System Health Footer

## Monitoring Cards

Bao gồm:

- Server uptime
- CPU
- RAM
- Database
- API response
- Backup status

---

## Màu trạng thái

### Healthy
```css
#16C784
```

### Medium
```css
#FAAD14
```

### Critical
```css
#FF4D4F
```

---

# 14. UI Style Guidelines

## Border Radius

```css
16px -> 24px
```

---

## Shadow

```css
0 4px 20px rgba(0,0,0,0.05)
```

---

## Spacing

```css
8px system
16px
24px
32px
```

---

# 15. Animation

## Hover Effects

Cards:
```css
transition: 0.25s ease;
```

---

## Loading Animation

- skeleton loading
- shimmer effect

---

## Chart Animation

- smooth fade in
- line drawing animation

---

# 16. Responsive Design

## Desktop
```txt
>= 1440px
```

- full dashboard

---

## Laptop
```txt
1024px - 1439px
```

- giảm spacing
- 4 KPI / row

---

## Tablet
```txt
768px - 1023px
```

- sidebar collapse
- chart stack vertical

---

## Mobile
```txt
< 768px
```

- hamburger menu
- cards vertical
- charts full width

---

# 17. UX Notes

## Dashboard cần:

- Realtime data update
- Scroll mượt
- Không quá nhiều màu
- Dễ đọc số liệu
- Ưu tiên khoảng trắng
- Visual hierarchy rõ ràng

---

# 18. Technical Suggestion

## Frontend Stack

### Recommended

```txt
ReactJS / NextJS
TailwindCSS
Shadcn/UI
Recharts
Framer Motion
```

---

## Icons

```txt
Lucide React
Heroicons
```

---

# 19. Dark Mode Suggestion

Dark mode tone:

```css
Background: #0F172A
Card: #111827
Sidebar: #020617
```

Text:
```css
#E5E7EB
```

---

# 20. Tổng kết UI Style

Dashboard cần mang cảm giác:

- Hiện đại
- Công nghệ
- Enterprise
- Realtime monitoring
- SaaS platform
- Smart city system

Tone tổng thể:
```txt
Blue Tech + White Clean + Analytics Style
```