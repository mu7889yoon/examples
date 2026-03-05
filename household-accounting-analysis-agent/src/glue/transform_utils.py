"""
ETL変換ユーティリティ関数

Glue ETL Jobで使用する変換ロジックを分離したモジュール。
ローカルでのテストが可能。

Requirements: 1.4, 5.2, 5.3
"""

import re
from datetime import date
from typing import Optional, Tuple


def parse_amount(amount_str: str) -> Optional[int]:
    """
    金額文字列を整数に変換する
    
    変換ルール:
    - カンマを除去
    - (振替)を除去
    - 整数に変換
    
    Args:
        amount_str: 金額文字列（例: "-5,487", "-60,000(振替)", "100,000"）
    
    Returns:
        整数値、変換できない場合はNone
    
    Examples:
        >>> parse_amount("-5,487")
        -5487
        >>> parse_amount("-60,000(振替)")
        -60000
        >>> parse_amount("100,000")
        100000
        >>> parse_amount("-1")
        -1
        >>> parse_amount("0")
        0
    """
    if amount_str is None or amount_str.strip() == "":
        return None
    
    try:
        # (振替)を除去
        cleaned = re.sub(r'\(振替\)', '', amount_str)
        # カンマを除去
        cleaned = cleaned.replace(',', '')
        # 空白を除去
        cleaned = cleaned.strip()
        # 整数に変換
        return int(cleaned)
    except (ValueError, AttributeError):
        return None


def parse_date(date_str: str, year: int) -> Optional[date]:
    """
    日付文字列をdate型に変換する
    
    変換ルール:
    - "MM/DD(曜日)" 形式から月と日を抽出
    - 年は引数で指定された値を使用
    
    Args:
        date_str: 日付文字列（例: "01/03(金)", "12/31(火)"）
        year: 年（例: 2025）
    
    Returns:
        date型、変換できない場合はNone
    
    Examples:
        >>> parse_date("01/03(金)", 2025)
        datetime.date(2025, 1, 3)
        >>> parse_date("12/31(火)", 2025)
        datetime.date(2025, 12, 31)
    """
    if date_str is None or date_str.strip() == "":
        return None
    
    try:
        # 曜日部分を除去（括弧内の文字を削除）
        cleaned = re.sub(r'\([^)]+\)', '', date_str)
        cleaned = cleaned.strip()
        
        # MM/DD形式をパース
        parts = cleaned.split('/')
        if len(parts) != 2:
            return None
        
        month = int(parts[0])
        day = int(parts[1])
        
        return date(year, month, day)
    except (ValueError, AttributeError, IndexError):
        return None


def extract_year_month_from_filename(filename: str) -> Tuple[Optional[int], Optional[int]]:
    """
    ファイル名から年月を抽出する
    
    Args:
        filename: ファイル名（例: "202501.csv", "data/202502.csv"）
    
    Returns:
        (年, 月)のタプル、抽出できない場合は(None, None)
    
    Examples:
        >>> extract_year_month_from_filename("202501.csv")
        (2025, 1)
        >>> extract_year_month_from_filename("data/202512.csv")
        (2025, 12)
    """
    if filename is None:
        return None, None
    
    match = re.search(r'(\d{4})(\d{2})\.csv', filename)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None


def clean_financial_institution(value: str) -> Optional[str]:
    """
    金融機関名をクリーンアップする
    
    Args:
        value: 金融機関名（複数の機関名が連結されている場合がある）
    
    Returns:
        クリーンアップされた金融機関名
    
    Examples:
        >>> clean_financial_institution("三井住友カード (Vpass ID)")
        '三井住友カード (Vpass ID)'
        >>> clean_financial_institution("三井住友銀行三井住友カード (Vpass ID)")
        '三井住友銀行'
    """
    if value is None or value.strip() == "":
        return None
    
    # 複数の金融機関名が連結されている場合、最初のものを取得
    # パターン: "三井住友銀行三井住友カード (Vpass ID)" -> "三井住友銀行"
    # 一般的なパターンとして、"銀行"や"カード"で区切る
    value = value.strip()
    
    # 「未設定」が含まれる場合は除去
    value = re.sub(r'未設定', '', value)
    
    return value.strip() if value.strip() else None


def validate_schema(row: dict) -> bool:
    """
    行データが必要なスキーマを満たしているか検証する
    
    Args:
        row: 行データの辞書
    
    Returns:
        スキーマが有効な場合True
    """
    required_fields = ['date', 'description', 'amount', 'financial_institution', 
                       'major_category', 'minor_category']
    
    for field in required_fields:
        if field not in row:
            return False
    
    # dateはdate型であること
    if row['date'] is not None and not isinstance(row['date'], date):
        return False
    
    # amountは整数であること
    if row['amount'] is not None and not isinstance(row['amount'], int):
        return False
    
    return True


def transform_row(row: dict, year: int) -> dict:
    """
    CSVの1行を変換する
    
    Args:
        row: CSVの行データ（辞書形式）
        year: 年
    
    Returns:
        変換後の行データ
    """
    return {
        'date': parse_date(row.get('日付', ''), year),
        'description': row.get('内容', '').strip() if row.get('内容') else None,
        'amount': parse_amount(row.get('金額（円）', '')),
        'financial_institution': clean_financial_institution(row.get('保有金融機関', '')),
        'major_category': row.get('major_category', '').strip() if row.get('major_category') else None,
        'minor_category': row.get('minor_category', '').strip() if row.get('minor_category') else None,
        'memo': row.get('メモ', '').strip() if row.get('メモ') else None,
    }
