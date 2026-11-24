"""Read the register's labeled columns and retain physical worksheet row numbers."""

import json
import posixpath
import re
import sys
from datetime import date, timedelta
from xml.etree import ElementTree as ET
from zipfile import ZipFile


NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL_ID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
HEADERS = {'S/N': 'serial', 'PREFIX': 'title', 'NAME': 'name', 'PHONE NUMBER': 'phone', 'B/DAY': 'birthday', 'EMAIL': 'email'}


def rich_text(element):
    return ''.join(node.text or '' for node in element.iter(NS + 't'))


def read_register(path):
    with ZipFile(path) as archive:
        def xml(name):
            return ET.fromstring(archive.read(name))

        strings = [rich_text(item) for item in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in archive.namelist() else []
        styles = xml('xl/styles.xml') if 'xl/styles.xml' in archive.namelist() else None
        formats = styles.find(NS + 'cellXfs') if styles is not None else []
        workbook = xml('xl/workbook.xml')
        properties = workbook.find(NS + 'workbookPr')
        epoch = date(1904, 1, 1) if properties is not None and properties.get('date1904') in ('1', 'true') else date(1899, 12, 30)
        targets = {rel.get('Id'): rel.get('Target') for rel in xml('xl/_rels/workbook.xml.rels')}
        result = []
        header_found = False

        def value(cell):
            raw = cell.findtext(NS + 'v', '')
            kind = cell.get('t', 'n')
            if kind == 's':
                return strings[int(raw)].strip()
            if kind == 'inlineStr':
                return rich_text(cell).strip()
            return raw.strip()

        for sheet in workbook.find(NS + 'sheets'):
            target = targets[sheet.get(REL_ID)]
            sheet_path = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
            columns = {}
            for row in xml(sheet_path).find(NS + 'sheetData'):
                cells = {re.match(r'[A-Z]+', cell.get('r')).group(): cell for cell in row if cell.tag == NS + 'c'}
                header = {HEADERS[text]: column for column, cell in cells.items() if (text := value(cell).upper()) in HEADERS}
                if set(header) == set(HEADERS.values()):
                    header_found = True
                    columns = header
                    continue
                if not columns:
                    continue
                data = {field: value(cells[column]) if column in cells else '' for field, column in columns.items()}
                if not re.fullmatch(r'\d+\.?', data.pop('serial')) or not data['name']:
                    continue
                problems = []
                for field, column in columns.items():
                    cell = cells.get(column)
                    if cell is not None and (cell.find(NS + 'f') is not None or cell.get('t') == 'e'):
                        problems.append('invalid_' + field + '_cell')
                birthday_cell = cells.get(columns['birthday'])
                if data['birthday'] and birthday_cell.get('t', 'n') == 'n':
                    style = int(birthday_cell.get('s', '0'))
                    fmt = int(formats[style].get('numFmtId', '0')) if style < len(formats) else 0
                    if fmt in (14, 15, 16, 22):
                        birthday = epoch + timedelta(days=int(float(data['birthday'])))
                        data['birthday'] = birthday.strftime('%m-%d') if fmt == 16 else birthday.isoformat()
                    else:
                        problems.append('ambiguous_birthday_format')
                result.append({'sheet': sheet.get('name'), 'row': int(row.get('r')), 'data': data, 'problems': problems})
        if not header_found:
            raise ValueError('Register headers not found')
        return result


if __name__ == '__main__':
    try:
        print(json.dumps(read_register(sys.argv[1])))
    except (OSError, ValueError, KeyError, TypeError, IndexError, OverflowError, AttributeError, ET.ParseError):
        sys.exit('Could not read the register workbook or find its expected columns.')
