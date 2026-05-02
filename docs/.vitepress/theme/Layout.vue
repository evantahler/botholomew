<script setup>
import DefaultTheme from "vitepress/theme";
import GitHubStars from "./GitHubStars.vue";
import HeroOwl from "./HeroOwl.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-info-after>
      <div class="hero-ctas">
        <GitHubStars />
      </div>
    </template>
    <template #home-hero-image>
      <HeroOwl />
    </template>
  </Layout>
</template>

<style scoped>
.hero-ctas {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

@media (max-width: 959px) {
  .hero-ctas {
    justify-content: center;
  }
}
</style>
