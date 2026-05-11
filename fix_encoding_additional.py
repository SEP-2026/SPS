#!/usr/bin/env python3
import re
from pathlib import Path

# Additional encoding fixes for missed patterns
additional_fixes = {
    r'thu\?c': 'thuộc',
    r'ch?n': 'chân',
    r'k?': 'ký',
}

files_to_fix = [
    'app/routes/auth.py',
    'app/routes/admin.py',
    'app/routes/employee.py',
    'app/services/employee_service.py',
]

def fix_file(filepath):
    """Fix additional encoding issues"""
    path = Path(filepath)
    if not path.exists():
        return False
    
    try:
        content = path.read_text(encoding='utf-8')
        original_content = content
        
        for pattern, replacement in additional_fixes.items():
            content = re.sub(pattern, replacement, content)
        
        if content != original_content:
            path.write_text(content, encoding='utf-8')
            print(f"✅ Fixed additional patterns: {filepath}")
            return True
        else:
            print(f"⏭️  No additional fixes needed: {filepath}")
            return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == '__main__':
    print("🔧 Fixing additional encoding patterns...\n")
    
    for file in files_to_fix:
        fix_file(file)
    
    print(f"\n✨ Done!")
