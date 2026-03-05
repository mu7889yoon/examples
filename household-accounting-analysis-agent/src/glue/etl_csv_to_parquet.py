"""
Glue ETL Job: CSV to Parquet変換スクリプト

家計簿CSVデータをParquet形式に変換し、年月パーティションでS3に保存する。

Requirements: 1.1, 1.2, 1.3, 1.4, 5.2, 5.3
"""

import sys
import re
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, regexp_replace, when, lit, trim, 
    substring, to_date, concat, year, month
)
from pyspark.sql.types import IntegerType, DateType, StringType


def parse_amount(amount_col):
    """
    金額文字列を整数に変換する
    
    変換ルール:
    - カンマを除去
    - (振替)を除去
    - 整数に変換
    
    例: "-5,487" -> -5487, "-60,000(振替)" -> -60000, "100,000" -> 100000
    """
    # (振替)を除去
    cleaned = regexp_replace(amount_col, r'\(振替\)', '')
    # カンマを除去
    cleaned = regexp_replace(cleaned, ',', '')
    # 整数に変換
    return cleaned.cast(IntegerType())


def parse_date(date_col, year_value):
    """
    日付文字列をDATE型に変換する
    
    変換ルール:
    - "MM/DD(曜日)" 形式から月と日を抽出
    - 年はファイル名から取得した値を使用
    
    例: "01/03(金)" + year=2025 -> 2025-01-03
    """
    # MM/DD部分を抽出（曜日部分を除去）
    mm_dd = regexp_replace(date_col, r'\([^)]+\)', '')
    # YYYY-MM-DD形式に変換
    date_str = concat(lit(str(year_value)), lit('-'), mm_dd)
    # MM/DDをMM-DDに変換
    date_str = regexp_replace(date_str, '/', '-')
    return to_date(date_str, 'yyyy-MM-dd')


def extract_year_month_from_filename(filename):
    """
    ファイル名から年月を抽出する
    
    例: "202501.csv" -> (2025, 1)
    """
    match = re.search(r'(\d{4})(\d{2})\.csv', filename)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None


def main():
    # Glue Job引数を取得
    args = getResolvedOptions(sys.argv, [
        'JOB_NAME',
        'SOURCE_BUCKET',
        'DATA_BUCKET',
        'SOURCE_KEY'  # 処理対象のCSVファイルキー（例: 202501.csv）
    ])
    
    # SparkContext と GlueContext の初期化
    sc = SparkContext()
    glueContext = GlueContext(sc)
    spark = glueContext.spark_session
    job = Job(glueContext)
    job.init(args['JOB_NAME'], args)
    
    source_bucket = args['SOURCE_BUCKET']
    data_bucket = args['DATA_BUCKET']
    source_key = args['SOURCE_KEY']
    
    # ファイル名から年月を抽出
    file_year, file_month = extract_year_month_from_filename(source_key)
    if file_year is None:
        raise ValueError(f"Invalid filename format: {source_key}. Expected format: YYYYMM.csv")
    
    # CSVファイルを読み込み
    source_path = f"s3://{source_bucket}/{source_key}"
    
    # CSVを読み込み（ヘッダーあり、エンコーディングはUTF-8）
    # multiLineオプションで改行を含むヘッダー/値に対応
    df = spark.read.option("header", "true") \
                   .option("encoding", "UTF-8") \
                   .option("quote", '"') \
                   .option("multiLine", "true") \
                   .option("escape", '"') \
                   .csv(source_path)
    
    # デバッグ: カラム名を出力
    print(f"CSV columns: {df.columns}")
    
    # カラム名に改行が含まれているため、インデックスまたは部分一致で取得
    # CSVカラム順序: 計算対象(0), 日付(1), 内容(2), 金額（円）(3), 保有金融機関(4), 大項目(5), 中項目(6), メモ(7), 振替(8), 削除(9)
    columns = df.columns
    
    # カラム名を部分一致で検索する関数
    def find_column(columns, keyword):
        for c in columns:
            if keyword in c:
                return c
        return None
    
    date_col = find_column(columns, "日付")
    content_col = find_column(columns, "内容")
    amount_col = find_column(columns, "金額")
    institution_col = find_column(columns, "保有金融機関")
    major_col = find_column(columns, "大項目")
    minor_col = find_column(columns, "中項目")
    memo_col = find_column(columns, "メモ")
    
    print(f"Found columns - date: {date_col}, content: {content_col}, amount: {amount_col}")
    print(f"institution: {institution_col}, major: {major_col}, minor: {minor_col}, memo: {memo_col}")
    
    # 必要なカラムのみ選択（バッククォートでエスケープ）
    df_clean = df.select(
        col(f"`{date_col}`").alias("date_str") if date_col else lit(None).alias("date_str"),
        col(f"`{content_col}`").alias("description") if content_col else lit(None).alias("description"),
        col(f"`{amount_col}`").alias("amount_str") if amount_col else lit(None).alias("amount_str"),
        col(f"`{institution_col}`").alias("financial_institution") if institution_col else lit(None).alias("financial_institution"),
        col(f"`{major_col}`").alias("major_category") if major_col else lit(None).cast(StringType()).alias("major_category"),
        col(f"`{minor_col}`").alias("minor_category") if minor_col else lit(None).cast(StringType()).alias("minor_category"),
        col(f"`{memo_col}`").alias("memo") if memo_col else lit(None).alias("memo")
    )
    
    # 空行をフィルタリング（日付が空の行を除外）
    df_filtered = df_clean.filter(
        (col("date_str").isNotNull()) & 
        (trim(col("date_str")) != "")
    )
    
    # データ変換
    df_transformed = df_filtered \
        .withColumn("date", parse_date(col("date_str"), file_year)) \
        .withColumn("amount", parse_amount(col("amount_str"))) \
        .withColumn("year", lit(file_year)) \
        .withColumn("month", lit(file_month))
    
    # 最終スキーマでカラムを選択
    df_final = df_transformed.select(
        col("date"),
        col("description"),
        col("amount"),
        col("financial_institution"),
        col("major_category"),
        col("minor_category"),
        col("memo"),
        col("year"),
        col("month")
    )
    
    # Parquet形式で書き出し（年月パーティション）
    # partitionOverwriteMode=dynamicで該当パーティションのみ上書き
    output_path = f"s3://{data_bucket}/transactions/"
    
    spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")
    
    df_final.write \
        .mode("overwrite") \
        .partitionBy("year", "month") \
        .parquet(output_path)
    
    job.commit()
    
    print(f"ETL completed successfully. Processed {df_final.count()} records from {source_key}")


if __name__ == "__main__":
    main()
