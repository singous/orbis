"""Copy identities by semantic position; authored text is never rewritten."""

from uuid import UUID

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.schemas.data_table import TableDefinition


def copy_definition(source: TableDefinition):
    field_ids = {field.id: new_uuidv7() for field in source.fields}
    view_ids = {view.id: new_uuidv7() for view in source.views}
    option_ids = {
        str(option.id): str(new_uuidv7())
        for field in source.fields
        for option in field.options
    }
    fields_by_id = {field.id: field for field in source.fields}

    def option_value(field_id, value):
        kind = fields_by_id[field_id].kind
        if kind == "select" and isinstance(value, str):
            return option_ids.get(value, value)
        if kind == "multi_select":
            if isinstance(value, list):
                return [option_ids.get(item, item) for item in value]
            if isinstance(value, str):
                return option_ids.get(value, value)
        return value

    fields = [
        field.model_copy(
            update={
                "id": field_ids[field.id],
                "options": [
                    option.model_copy(update={"id": UUID(option_ids[str(option.id)])})
                    for option in field.options
                ],
            }
        )
        for field in source.fields
    ]
    views = [
        view.model_copy(
            update={
                "id": view_ids[view.id],
                "field_ids": [field_ids[field] for field in view.field_ids],
                "widths": {
                    str(field_ids[field.id]): view.widths[str(field.id)]
                    for field in source.fields
                    if str(field.id) in view.widths
                },
                "sorts": [
                    item.model_copy(update={"field_id": field_ids[item.field_id]})
                    for item in view.sorts
                ],
                "filters": [
                    item.model_copy(
                        update={
                            "field_id": field_ids[item.field_id],
                            "value": option_value(item.field_id, item.value),
                        }
                    )
                    for item in view.filters
                ],
                "group_field_id": field_ids.get(view.group_field_id),
            }
        )
        for view in source.views
    ]
    definition = source.model_copy(
        update={
            "fields": fields,
            "views": views,
            "public_view_id": view_ids[source.public_view_id],
            "public_field_ids": [field_ids[field] for field in source.public_field_ids],
        }
    )
    # Revalidate model_copy updates so UUID fields retain their declared types.
    definition = TableDefinition.model_validate(definition.model_dump(mode="json"))

    def copy_values(values):
        return {
            str(field_ids[field.id]): option_value(field.id, values[str(field.id)])
            for field in source.fields
            if str(field.id) in values
        }

    return definition, copy_values
