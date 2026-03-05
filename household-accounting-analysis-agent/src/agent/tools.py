"""DuckDB query tools for household accounting analysis."""

import os
import duckdb
from strands import tool


class DuckDBConnection:
    """DuckDB connection manager with httpfs extension for S3 access."""
    
    _instance = None
    _conn = None
    
    @classmethod
    def get_connection(cls) -> duckdb.DuckDBPyConnection:
        """Get or create a DuckDB connection with httpfs configured."""
        if cls._conn is None:
            cls._conn = cls._create_connection()
        return cls._conn
    
    @classmethod
    def _create_connection(cls) -> duckdb.DuckDBPyConnection:
        """Create a new DuckDB connection with httpfs extension."""
        conn = duckdb.connect()
        
        # Install and load httpfs extension for S3 access
        conn.execute("INSTALL httpfs;")
        conn.execute("LOAD httpfs;")
        
        # Configure S3 region
        region = os.environ.get('AWS_REGION', 'ap-northeast-1')
        conn.execute(f"SET s3_region='{region}';")
        
        # Use credential chain (IAM role, environment variables, etc.)
        # This enables DuckDB to use IAM role credentials in AgentCore Runtime
        conn.execute("SET s3_use_ssl=true;")
        
        # Try to get credentials from environment or IAM role
        access_key = os.environ.get('AWS_ACCESS_KEY_ID')
        secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
        session_token = os.environ.get('AWS_SESSION_TOKEN')
        
        if access_key and secret_key:
            conn.execute(f"SET s3_access_key_id='{access_key}';")
            conn.execute(f"SET s3_secret_access_key='{secret_key}';")
            if session_token:
                conn.execute(f"SET s3_session_token='{session_token}';")
        else:
            # Use AWS SDK credential provider chain (for IAM roles)
            try:
                import boto3
                session = boto3.Session()
                credentials = session.get_credentials()
                if credentials:
                    frozen_credentials = credentials.get_frozen_credentials()
                    conn.execute(f"SET s3_access_key_id='{frozen_credentials.access_key}';")
                    conn.execute(f"SET s3_secret_access_key='{frozen_credentials.secret_key}';")
                    if frozen_credentials.token:
                        conn.execute(f"SET s3_session_token='{frozen_credentials.token}';")
            except Exception as e:
                print(f"Warning: Could not get AWS credentials from boto3: {e}")
        
        # Create view for transactions table
        data_bucket = os.environ.get('DATA_BUCKET')
        if data_bucket:
            try:
                conn.execute(f"""
                    CREATE OR REPLACE VIEW transactions AS 
                    SELECT * FROM read_parquet('s3://{data_bucket}/transactions/**/*.parquet')
                """)
            except Exception as e:
                print(f"Warning: Could not create transactions view: {e}")
        
        return conn
    
    @classmethod
    def reset_connection(cls):
        """Reset the connection (useful for testing)."""
        if cls._conn is not None:
            cls._conn.close()
            cls._conn = None


@tool
def query_transactions(sql_query: str) -> str:
    """家計簿データに対してSQLクエリを実行する。
    
    transactionsテーブルに対してSQLクエリを実行し、結果を返します。
    
    テーブル構造:
    - date: 日付 (DATE型)
    - description: 内容、利用店舗など (VARCHAR)
    - amount: 金額（円、マイナスは支出） (INTEGER)
    - financial_institution: 金融機関 (VARCHAR)
    - major_category: 大項目 (VARCHAR)
    - minor_category: 中項目 (VARCHAR)
    - memo: メモ (VARCHAR, nullable)
    
    Args:
        sql_query: 実行するSQLクエリ（transactionsテーブルに対して実行）
    
    Returns:
        クエリ結果のJSON文字列、またはエラーメッセージ
    """
    # Validate input
    if not sql_query or not sql_query.strip():
        return "エラー: クエリが空です。有効なSQLクエリを入力してください。"
    
    try:
        conn = DuckDBConnection.get_connection()
        result = conn.execute(sql_query).fetchdf()
        
        # Handle empty results
        if result.empty:
            return "クエリ結果: データが見つかりませんでした。"
        
        return result.to_json(orient='records', force_ascii=False)
    
    except duckdb.ParserException as e:
        return f"SQLの構文エラー: {str(e)}。クエリの構文を確認してください。"
    
    except duckdb.CatalogException as e:
        return f"テーブルまたはカラムが見つかりません: {str(e)}。transactionsテーブルの構造を確認してください。"
    
    except duckdb.IOException as e:
        return f"S3接続エラー: {str(e)}。データバケットへのアクセス権限を確認してください。"
    
    except duckdb.Error as e:
        return f"クエリ実行エラー: {str(e)}"
    
    except Exception as e:
        return f"予期しないエラーが発生しました: {str(e)}"
