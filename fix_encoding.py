#!/usr/bin/env python3
import re
from pathlib import Path

# Define all encoding fixes
fixes = {
    # Pattern 1: "th?y" -> "thấy"
    r'th\?y': 'thấy',
    # Pattern 2: "du?c" -> "được"
    r'du\?c': 'được',
    # Pattern 3: "t?i" -> "tại"
    r't\?i': 'tại',
    # Pattern 4: "d?y" -> "đầy"
    r'd\?y': 'đầy',
    # Pattern 5: "dang" -> "đang"
    r'\bdang\b': 'đang',
    # Pattern 6: "khong" -> "không"
    r'\bkhong\b': 'không',
    # Pattern 7: "Khong" -> "Không"
    r'\bKhong\b': 'Không',
    # Pattern 8: "dã t?n t?i" -> "đã tồn tại"
    r'dã t\?n t\?i': 'đã tồn tại',
    # Pattern 9: "Chua gan" -> "Chưa gán"
    r'Chua gan': 'Chưa gán',
    # Pattern 10: specific text fixes
    r'Email employee dã t\?n t\?i': 'Email employee đã tồn tại',
    r'Tai khoan nhan vien khong ton tai': 'Tài khoản nhân viên không tồn tại',
    r'Mat khau cu khong dung': 'Mật khẩu cũ không đúng',
    r'Xac nhan mat khau khong khop': 'Xác nhận mật khẩu không khớp',
    # Pattern 11: "quy?n" -> "quyền"
    r'quy\?n': 'quyền',
}

# Files to fix
files_to_fix = [
    'app/routes/auth.py',
    'app/routes/admin.py',
    'app/routes/employee.py',
    'app/services/employee_service.py',
]

def fix_file(filepath):
    """Fix encoding issues in a single file"""
    path = Path(filepath)
    if not path.exists():
        print(f"⚠️  File not found: {filepath}")
        return False
    
    try:
        # Read the file
        content = path.read_text(encoding='utf-8')
        original_content = content
        
        # Apply all fixes
        for pattern, replacement in fixes.items():
            content = re.sub(pattern, replacement, content)
        
        # Write back if changed
        if content != original_content:
            path.write_text(content, encoding='utf-8')
            print(f"✅ Fixed: {filepath}")
            return True
        else:
            print(f"⏭️  No changes needed: {filepath}")
            return False
    except Exception as e:
        print(f"❌ Error fixing {filepath}: {e}")
        return False

if __name__ == '__main__':
    print("🔧 Fixing Vietnamese text encoding issues...\n")
    
    fixed_count = 0
    for file in files_to_fix:
        if fix_file(file):
            fixed_count += 1
    
    print(f"\n✨ Done! Fixed {fixed_count} files.")
