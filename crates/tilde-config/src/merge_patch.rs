use serde_json::Value;

/// Applies an RFC 7386 JSON Merge Patch to `target` in place.
///
/// Objects merge recursively, `null` removes a key, anything else replaces.
pub fn merge_patch(target: &mut Value, patch: &Value) {
    let Value::Object(patch_map) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(serde_json::Map::new());
    }
    let Value::Object(target_map) = target else {
        unreachable!("target was just made an object")
    };
    for (key, value) in patch_map {
        if value.is_null() {
            target_map.remove(key);
        } else {
            merge_patch(target_map.entry(key.clone()).or_insert(Value::Null), value);
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::merge_patch;

    #[test]
    fn scalar_values_are_replaced() {
        let mut target = json!({"a": 1, "b": "x"});
        merge_patch(&mut target, &json!({"a": 2}));
        assert_eq!(target, json!({"a": 2, "b": "x"}));
    }

    #[test]
    fn null_removes_key() {
        let mut target = json!({"a": 1, "b": 2});
        merge_patch(&mut target, &json!({"a": null}));
        assert_eq!(target, json!({"b": 2}));
    }

    #[test]
    fn nested_objects_are_merged() {
        let mut target = json!({"t": {"x": 1, "y": 2}, "keep": true});
        merge_patch(&mut target, &json!({"t": {"y": 3, "z": 4}}));
        assert_eq!(target, json!({"t": {"x": 1, "y": 3, "z": 4}, "keep": true}));
    }
}
