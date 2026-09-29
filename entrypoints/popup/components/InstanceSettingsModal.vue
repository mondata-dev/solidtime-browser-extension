<script setup lang="ts">
import {
    Modal,
    PrimaryButton,
    SecondaryButton,
    TextInput,
    InputLabel,
} from "@solidtime/ui";
import {
    endpoint,
    clientId,
    saveInstanceSettings,
    DEFAULT_ENDPOINT,
    DEFAULT_CLIENT_ID,
} from "../../utils/oauth";
import {
    getGitLabDomains,
    parseGitLabDomains,
    setGitLabDomains,
} from "../../utils/gitlabDomains";
import { ref, watch } from "vue";

const props = defineProps({
    show: {
        type: Boolean,
        default: false,
    },
    maxWidth: {
        type: String,
        default: "2xl",
    },
    closeable: {
        type: Boolean,
        default: true,
    },
});

const emit = defineEmits(["close"]);

const tempEndpoint = ref(endpoint.value);
const tempClientId = ref(clientId.value);
const tempGitLabDomains = ref("");

// Settings load asynchronously from browser.storage, so refresh the form whenever it opens
watch(
    () => props.show,
    async (show) => {
        if (show) {
            tempEndpoint.value = endpoint.value;
            tempClientId.value = clientId.value;
            tempGitLabDomains.value = (await getGitLabDomains()).join(", ");
        }
    },
);

const close = () => {
    emit("close");
};

async function submit() {
    // remove last character if it is a slash
    if (tempEndpoint.value[tempEndpoint.value.length - 1] === "/") {
        tempEndpoint.value = tempEndpoint.value.slice(0, -1);
    }
    await saveInstanceSettings(tempEndpoint.value, tempClientId.value);
    await setGitLabDomains(parseGitLabDomains(tempGitLabDomains.value));
    emit("close");
}
</script>

<template>
    <Modal
        :show="show"
        :maxWidth="maxWidth"
        :closeable="closeable"
        @close="close"
    >
        <div class="px-6 py-4">
            <div class="text-lg font-medium text-white" role="heading">
                Instance Settings
            </div>

            <div class="mt-4 text-sm text-muted">
                Configure your Solidtime instance endpoint and client ID. These
                settings are only needed if you're using a self-hosted instance.
            </div>

            <div class="mt-4 text-sm text-muted flex flex-col justify-center">
                <InputLabel
                    for="instanceEndpoint"
                    value="Solidtime Instance Endpoint"
                />
                <TextInput
                    id="instanceEndpoint"
                    v-model="tempEndpoint"
                    name="instanceEndpoint"
                    type="text"
                    class="mt-2 block w-full"
                    required
                    @keydown.enter="submit()"
                />
            </div>

            <div class="mt-4 text-sm text-muted flex flex-col justify-center">
                <InputLabel
                    for="clientId"
                    value="Solidtime Instance Client Id"
                />
                <TextInput
                    id="clientId"
                    v-model="tempClientId"
                    name="clientId"
                    type="text"
                    class="mt-2 block w-full"
                    required
                    @keydown.enter="submit()"
                />
            </div>

            <div class="flex justify-start mt-4">
                <button
                    @click="
                        tempEndpoint = DEFAULT_ENDPOINT;
                        tempClientId = DEFAULT_CLIENT_ID;
                    "
                    class="text-sm text-muted hover:text-white"
                >
                    Reset to defaults
                </button>
            </div>

            <div
                class="mt-6 pt-4 border-t border-card-background-separator text-sm text-muted flex flex-col justify-center"
            >
                <InputLabel
                    for="gitlabDomains"
                    value="Self-hosted GitLab domains"
                />
                <TextInput
                    id="gitlabDomains"
                    v-model="tempGitLabDomains"
                    name="gitlabDomains"
                    type="text"
                    placeholder="gitlab.example.com, git.company.org"
                    class="mt-2 block w-full"
                    @keydown.enter="submit()"
                />
                <p class="mt-2 text-xs">
                    gitlab.com works automatically. Separate multiple domains
                    with commas. Reload open GitLab tabs after saving.
                </p>
            </div>
        </div>

        <div
            class="flex flex-row justify-end px-6 py-4 border-t space-x-2 border-card-background-separator bg-default-background rounded-b-2xl text-end"
        >
            <SecondaryButton @click="close">Cancel</SecondaryButton>
            <PrimaryButton @click="submit">Save</PrimaryButton>
        </div>
    </Modal>
</template>
