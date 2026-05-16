#!/usr/bin/env python3
"""
Assign employees to parking lots based on parking name matching from email prefix.
Employee email format: "bx{parking_name}@gmail.com" where spaces are removed.
"""

import unicodedata
from app.database import SessionLocal
from app.models.models import User, ParkingLot, OwnerParking

def remove_diacritics(text: str) -> str:
    """Remove Vietnamese diacritics from text."""
    nfd = unicodedata.normalize('NFD', text)
    return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')

def normalize_name(name: str) -> str:
    """Normalize parking lot name for matching."""
    name = remove_diacritics(name)
    return name.lower().replace(" ", "").replace("-", "").replace(".", "")

def assign_employees():
    db = SessionLocal()
    
    # Build parking lot name mapping
    parking_lots = db.query(ParkingLot).all()
    lot_mapping = {}
    for lot in parking_lots:
        normalized = normalize_name(lot.name)
        lot_mapping[normalized] = lot
        print(f"Parking lot: {lot.name} (ID: {lot.id}) → normalized: {normalized}")
    
    # Get all employees without parking_id
    employees = db.query(User).filter(User.role == 'employee', User.parking_id.is_(None)).all()
    print(f"\nFound {len(employees)} employees without parking_id\n")
    
    # Try to match employees to parking lots based on email prefix
    assigned_count = 0
    unmatched = []
    
    for emp in employees:
        # Extract prefix from email (e.g., "bxtaodan" from "bxtaodan@gmail.com")
        email_prefix = emp.email.split("@")[0]
        # Remove "bx" prefix (common to all)
        candidate = email_prefix[2:] if email_prefix.startswith("bx") else email_prefix
        
        # Try to find matching parking lot
        candidate_normalized = normalize_name(candidate)
        matched_lot = None
        
        # Try exact match first
        if candidate_normalized in lot_mapping:
            matched_lot = lot_mapping[candidate_normalized]
        else:
            # Try partial match (substring) - skip "" prefix for comparison
            for norm_name, lot in lot_mapping.items():
                # Remove "baixe" prefix from normalized lot name for substring match
                lot_suffix = norm_name[5:] if norm_name.startswith("baixe") else norm_name
                # Check if candidate matches the lot suffix or full name
                if (candidate_normalized == lot_suffix or 
                    candidate_normalized in norm_name or 
                    norm_name in candidate_normalized or
                    candidate_normalized in lot_suffix or
                    lot_suffix in candidate_normalized):
                    matched_lot = lot
                    break
        
        if matched_lot:
            # Find the owner of this parking lot
            owner_parking = db.query(OwnerParking).filter(
                OwnerParking.parking_id == matched_lot.id
            ).first()
            
            if owner_parking:
                emp.parking_id = matched_lot.id
                emp.owner_id = owner_parking.owner_id
                assigned_count += 1
                print(f"✓ {emp.email} → {matched_lot.name} (Owner ID: {owner_parking.owner_id})")
            else:
                unmatched.append((emp.email, matched_lot.name, "No owner assigned to lot"))
                print(f"✗ {emp.email} → {matched_lot.name} (but no owner assigned)")
        else:
            unmatched.append((emp.email, candidate, "No matching parking lot"))
            print(f"✗ {emp.email} → No matching parking lot (tried: {candidate})")
    
    # Commit the changes
    if assigned_count > 0:
        db.commit()
        print(f"\n✓ Successfully assigned {assigned_count} employees")
    else:
        print("\n⚠ No employees assigned")
    
    if unmatched:
        print(f"\n⚠ {len(unmatched)} employees could not be matched:")
        for email, tried, reason in unmatched[:10]:
            print(f"  - {email}: {reason} ({tried})")
    
    db.close()

if __name__ == "__main__":
    assign_employees()
