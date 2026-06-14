from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.owner import require_owner
from app.services import owner_finance as finance_service
from app.services import vietqr as vietqr_service
from app.services.vietqr import VietQRError

router = APIRouter(prefix="/owner", tags=["owner-finance"])


class BankAccountCreateRequest(BaseModel):
    bankCode: str = Field(min_length=2, max_length=20)
    bankName: str = Field(min_length=2, max_length=100)
    accountNumber: str = Field(min_length=4, max_length=50)
    accountHolderName: str = Field(min_length=2, max_length=255)
    isDefault: bool = False


class BankAccountUpdateRequest(BaseModel):
    bankCode: str | None = Field(default=None, max_length=20)
    bankName: str | None = Field(default=None, max_length=100)
    accountNumber: str | None = Field(default=None, max_length=50)
    accountHolderName: str | None = Field(default=None, max_length=255)
    isDefault: bool | None = None


class WithdrawalCreateRequest(BaseModel):
    amount: float = Field(gt=0)
    bankAccountId: int | None = None
    note: str | None = Field(default=None, max_length=500)


class VietQrLookupRequest(BaseModel):
    bankBin: str = Field(min_length=6, max_length=20)
    accountNumber: str = Field(min_length=6, max_length=50)


class CashReconciliationCreateRequest(BaseModel):
    parkingId: int
    date: str
    employeeId: int | None = None
    depositedAmount: float | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^(pending|deposited|variance)$")
    note: str | None = Field(default=None, max_length=500)


class CashReconciliationUpdateRequest(BaseModel):
    depositedAmount: float | None = Field(default=None, ge=0)
    employeeId: int | None = None
    status: str | None = Field(default=None, pattern="^(pending|deposited|variance)$")
    note: str | None = Field(default=None, max_length=500)


def _handle_value_error(error: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))


@router.get("/balance")
def owner_balance(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return finance_service.get_owner_balance_payload(current_user.id, db)


@router.get("/vietqr/banks")
def list_vietqr_banks(
    current_user: User = Depends(require_owner),
):
    del current_user
    try:
        banks = vietqr_service.get_banks()
    except VietQRError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error
    return {"banks": banks, "total": len(banks), "source": "vietqr"}


@router.post("/vietqr/lookup")
def lookup_vietqr_account(
    payload: VietQrLookupRequest,
    current_user: User = Depends(require_owner),
):
    del current_user
    try:
        result = vietqr_service.lookup_account_holder(
            bank_bin=payload.bankBin,
            account_number=payload.accountNumber,
        )
    except VietQRError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    return result


@router.get("/bank-accounts")
def list_bank_accounts(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return {"accounts": finance_service.list_bank_accounts(current_user.id, db)}


@router.post("/bank-accounts", status_code=status.HTTP_201_CREATED)
def create_bank_account(
    payload: BankAccountCreateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    account = finance_service.create_bank_account(current_user.id, payload.model_dump(), db)
    return {"account": account}


@router.patch("/bank-accounts/{account_id}")
def update_bank_account(
    account_id: int,
    payload: BankAccountUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    try:
        account = finance_service.update_bank_account(
            current_user.id,
            account_id,
            payload.model_dump(exclude_unset=True),
            db,
        )
    except ValueError as error:
        raise _handle_value_error(error) from error
    return {"account": account}


@router.delete("/bank-accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bank_account(
    account_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    try:
        finance_service.delete_bank_account(current_user.id, account_id, db)
    except ValueError as error:
        raise _handle_value_error(error) from error


@router.get("/withdrawals")
def list_withdrawals(
    date_from: str | None = Query(default=None, alias="dateFrom"),
    date_to: str | None = Query(default=None, alias="dateTo"),
    status_filter: str | None = Query(default="all", alias="status"),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return finance_service.list_withdrawals(
        current_user.id,
        db,
        date_from=date_from,
        date_to=date_to,
        status=status_filter,
    )


@router.post("/withdrawals", status_code=status.HTTP_201_CREATED)
def create_withdrawal(
    payload: WithdrawalCreateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    try:
        withdrawal = finance_service.create_withdrawal(current_user.id, payload.model_dump(), db)
    except ValueError as error:
        raise _handle_value_error(error) from error
    return {"withdrawal": withdrawal}


@router.patch("/withdrawals/{withdrawal_id}/cancel")
def cancel_withdrawal(
    withdrawal_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    try:
        withdrawal = finance_service.cancel_withdrawal(current_user.id, withdrawal_id, db)
    except ValueError as error:
        raise _handle_value_error(error) from error
    return {"withdrawal": withdrawal}


@router.get("/cash-reconciliation")
def list_cash_reconciliation(
    date_from: str | None = Query(default=None, alias="dateFrom"),
    date_to: str | None = Query(default=None, alias="dateTo"),
    parking_id: int | None = Query(default=None, alias="parkingId"),
    status_filter: str | None = Query(default="all", alias="status"),
    employee_id: int | None = Query(default=None, alias="employeeId"),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return finance_service.list_cash_reconciliation(
        current_user.id,
        db,
        date_from=date_from,
        date_to=date_to,
        parking_id=parking_id,
        status=status_filter,
        employee_id=employee_id,
    )


@router.get("/cash-reconciliation/{slip_id}")
def get_cash_reconciliation(
    slip_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    try:
        return finance_service.get_cash_reconciliation_slip(current_user.id, slip_id, db)
    except ValueError as error:
        raise _handle_value_error(error) from error


@router.post("/cash-reconciliation", status_code=status.HTTP_201_CREATED)
def create_cash_reconciliation(
    payload: CashReconciliationCreateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    try:
        slip = finance_service.create_cash_reconciliation_slip(current_user.id, payload.model_dump(), db)
    except ValueError as error:
        raise _handle_value_error(error) from error
    return {"slip": slip}


@router.patch("/cash-reconciliation/{slip_id}")
def update_cash_reconciliation(
    slip_id: int,
    payload: CashReconciliationUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    try:
        slip = finance_service.update_cash_reconciliation_slip(
            current_user.id,
            slip_id,
            payload.model_dump(exclude_unset=True),
            db,
        )
    except ValueError as error:
        raise _handle_value_error(error) from error
    return {"slip": slip}


@router.post("/cash-reconciliation/auto-generate")
def auto_generate_cash_reconciliation(
    date_from: str | None = Query(default=None, alias="dateFrom"),
    date_to: str | None = Query(default=None, alias="dateTo"),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return finance_service.auto_generate_cash_slips(
        current_user.id,
        db,
        date_from=date_from,
        date_to=date_to,
    )
