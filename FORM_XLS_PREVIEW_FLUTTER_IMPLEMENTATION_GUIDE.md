# Form XLS Preview Flutter Implementation Guide

## Purpose

This document is for Flutter implementation of the **Form XLS preview feature** that uses:

- `GET /api/forms/analytics/export/preview`

This endpoint returns **all sheets with full row data** in a single JSON response so the app can render an Excel-like UI without parsing XLSX bytes.

---

## 1) Endpoint Overview

### API

`GET /api/forms/analytics/export/preview`

### Auth

- Header: `Authorization: Bearer <admin-token>`
- Role required: `ADMIN`

### Content type

- Response: `application/json`

### Query parameters

Supported filters (same as export):

- `from_date` (YYYY-MM-DD)
- `to_date` (YYYY-MM-DD)
- `search` or `q`
- `status` (`ACTIVE` or `INACTIVE`)
- `staffType` (`ALP`, `LP`, `TM`)
- `dutyType` (`SIGN_ON`, `SIGN_OFF`)

Legacy preview params are accepted but ignored in all-sheets mode:

- `sheetKey`
- `page`
- `limit`

---

## 2) Response Shape (Current Contract)

```json
{
  "success": true,
  "workbook": {
    "title": "Form submissions analytics export",
    "generated_at": "2026-03-26 16:40:15",
    "filename": "form-submissions-all-2026-03-26-164015.xlsx",
    "filters": {
      "from_date": null,
      "to_date": null,
      "search": null,
      "status": null,
      "staffType": null,
      "dutyType": null
    },
    "sheets": [
      {
        "key": "export_info",
        "name": "Export info",
        "staff_type": null,
        "duty_type": null,
        "columns": [
          { "key": "field", "header": "field", "width": 30 },
          { "key": "value", "header": "value", "width": 56 }
        ],
        "rows": [
          { "field": "export_generated_at", "value": "2026-03-26 16:40:15" }
        ],
        "row_count": 8,
        "column_count": 2
      },
      {
        "key": "ALP__SIGN_ON",
        "name": "SIGN ON ALP",
        "staff_type": "ALP",
        "duty_type": "SIGN_ON",
        "columns": [
          { "key": "user_id", "header": "User ID", "width": 18 },
          { "key": "name", "header": "Name", "width": 24 },
          { "key": "q_1", "header": "What did you work on today?", "width": 40 }
        ],
        "rows": [
          {
            "user_id": "emp_001",
            "name": "John Doe",
            "q_1": "Worked on dashboard integration"
          }
        ],
        "row_count": 50,
        "column_count": 12
      }
    ]
  },
  "meta": {
    "mode": "all_sheets_full",
    "deprecated_query_params_ignored": []
  }
}
```

---

## 3) Error Responses

### 401

```json
{
  "success": false,
  "message": "Authentication required"
}
```

### 403

```json
{
  "success": false,
  "message": "Admin access required"
}
```

### 400 validation examples

```json
{
  "success": false,
  "message": "from_date and to_date must be in YYYY-MM-DD format"
}
```

```json
{
  "success": false,
  "message": "from_date cannot be after to_date"
}
```

```json
{
  "success": false,
  "message": "status must be ACTIVE or INACTIVE"
}
```

```json
{
  "success": false,
  "message": "query.dutyType is required"
}
```

---

## 4) Flutter Model Layer

Use dynamic row values because each sheet can have different column sets.

```dart
class ExportPreviewResponse {
  final bool success;
  final WorkbookPreview workbook;
  final PreviewMeta? meta;

  ExportPreviewResponse({
    required this.success,
    required this.workbook,
    required this.meta,
  });
}

class WorkbookPreview {
  final String title;
  final String generatedAt;
  final String filename;
  final ExportFilters filters;
  final List<PreviewSheet> sheets;

  WorkbookPreview({
    required this.title,
    required this.generatedAt,
    required this.filename,
    required this.filters,
    required this.sheets,
  });
}

class ExportFilters {
  final String? fromDate;
  final String? toDate;
  final String? search;
  final String? status;
  final String? staffType;
  final String? dutyType;

  ExportFilters({
    required this.fromDate,
    required this.toDate,
    required this.search,
    required this.status,
    required this.staffType,
    required this.dutyType,
  });
}

class PreviewSheet {
  final String key;
  final String name;
  final String? staffType;
  final String? dutyType;
  final List<PreviewColumn> columns;
  final List<Map<String, dynamic>> rows;
  final int rowCount;
  final int columnCount;

  PreviewSheet({
    required this.key,
    required this.name,
    required this.staffType,
    required this.dutyType,
    required this.columns,
    required this.rows,
    required this.rowCount,
    required this.columnCount,
  });
}

class PreviewColumn {
  final String key;
  final String header;
  final int? width;

  PreviewColumn({
    required this.key,
    required this.header,
    required this.width,
  });
}

class PreviewMeta {
  final String mode;
  final List<String> deprecatedQueryParamsIgnored;

  PreviewMeta({
    required this.mode,
    required this.deprecatedQueryParamsIgnored,
  });
}
```

---

## 5) Dio API Integration

```dart
import 'package:dio/dio.dart';

class FormAnalyticsApi {
  final Dio dio;

  FormAnalyticsApi(this.dio);

  Future<Map<String, dynamic>> getExportPreview({
    String? fromDate,
    String? toDate,
    String? search,
    String? status,
    String? staffType,
    String? dutyType,
  }) async {
    final response = await dio.get(
      '/api/forms/analytics/export/preview',
      queryParameters: {
        if (fromDate != null && fromDate.isNotEmpty) 'from_date': fromDate,
        if (toDate != null && toDate.isNotEmpty) 'to_date': toDate,
        if (search != null && search.isNotEmpty) 'search': search,
        if (status != null && status.isNotEmpty) 'status': status,
        if (staffType != null && staffType.isNotEmpty) 'staffType': staffType,
        if (dutyType != null && dutyType.isNotEmpty) 'dutyType': dutyType,
      },
    );
    return response.data as Map<String, dynamic>;
  }
}
```

---

## 6) Flutter UI Architecture

Recommended structure:

1. Fetch preview once
2. Build sheet tabs from `workbook.sheets`
3. Render selected sheet as table/grid
4. Re-fetch when filters change

### Suggested widgets

- `DefaultTabController` + `TabBar` for sheet tabs
- `DataTable`, `PaginatedDataTable`, or `SfDataGrid` for rows
- Horizontal scroll wrapper for wide sheets

### Sheet tab source

- Tab label = `sheet.name`
- Optional badge = `sheet.rowCount`

### Table headers

- Use `sheet.columns[*].header`

### Table cell values

- For each row, resolve by column key:
  - `row[column.key]`
- If value is null/missing, display empty string

---

## 7) Example ViewModel/State Flow

```dart
class ExportPreviewState {
  final bool loading;
  final String? error;
  final WorkbookPreview? workbook;
  final int selectedTabIndex;

  ExportPreviewState({
    required this.loading,
    required this.error,
    required this.workbook,
    required this.selectedTabIndex,
  });
}
```

Flow:

1. `loading = true`
2. call API
3. parse response
4. set `workbook`
5. default selected tab:
   - first non-`export_info` sheet if exists
   - else index `0`

---

## 8) Rendering Helper Snippets

### Pick initial visible sheet

```dart
int initialSheetIndex(List<PreviewSheet> sheets) {
  final idx = sheets.indexWhere((s) => s.key != 'export_info');
  return idx == -1 ? 0 : idx;
}
```

### Safely read dynamic value

```dart
String cellText(Map<String, dynamic> row, String key) {
  final value = row[key];
  if (value == null) return '';
  return value.toString();
}
```

---

## 9) Filter UX Recommendations

Use same filters as backend:

- Date range: `from_date`, `to_date`
- Search: `search`
- Status: `ACTIVE` / `INACTIVE`
- Staff + duty pair:
  - If one is selected, send both

Validation before API call:

- Date format `YYYY-MM-DD`
- `from_date <= to_date`
- If `staffType` is selected, require `dutyType`
- If `dutyType` is selected, require `staffType`

---

## 10) Performance Notes

Since endpoint returns all sheets with full rows:

- Use lazy row building in UI (`ListView.builder` or grid virtualization)
- Avoid expensive per-cell formatting in build method
- Keep one parsed model in memory and only switch tab index
- Consider client-side search only within selected sheet if needed

If payload becomes too large later:

- backend can switch to per-sheet paged mode in future
- for now, this implementation is all-sheets-full by design

---

## 11) Download XLS File (Optional Action)

Preview API is for viewing data in app.
For actual file download, still use:

- `GET /api/forms/analytics/export` (binary XLSX)

You can provide two actions in UI:

- `Preview` -> JSON preview endpoint
- `Download Excel` -> XLSX endpoint

---

## 12) QA Checklist (Flutter)

- Tabs render for all returned sheets
- `export_info` tab is visible and readable
- Non-info tabs render dynamic columns correctly
- Rows are aligned with headers
- Filters correctly re-fetch data
- Validation errors show backend message
- Empty sheet (0 rows) state handled
- Wide sheet horizontal scrolling works

---

## 13) Quick Integration Summary

Implement this feature as:

1. Call `/api/forms/analytics/export/preview`
2. Parse `workbook.sheets`
3. Build tabs from each sheet
4. Build table from selected sheet `columns + rows`
5. Re-fetch with filters as needed

This gives a true Excel-like multi-sheet preview in Flutter without XLS binary parsing.

